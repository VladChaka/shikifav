import { ref, watch } from 'vue';
import type { Ref } from 'vue';
import { sendMessage } from '../lib/messaging';
import { getSession, setSession } from '../lib/storage';
import { apiErrorMessage, i18n } from '../lib/i18n';
import type { ApiError, TitleCard, UserRateRef, UserRateStatus } from '../lib/api/types';

// --- Pure optimistic-update reducer (unit-tested without Vue, docs/02) ---

export type RateAction =
    | { type: 'create'; status: UserRateStatus }
    | { type: 'update'; status: UserRateStatus }
    | { type: 'delete' };

// Placeholder id of an optimistically created rate before the server responds.
// It is never sent to the API: the card stays busy (all actions locked) until
// the real id arrives, so a create -> delete race without an id cannot happen.
export const OPTIMISTIC_RATE_ID = '';

// The pre-action card, kept as-is: applyRateAction never mutates its input,
// so restoring is just returning this reference.
export interface RateSnapshot {
    card: TitleCard;
}

export function applyRateAction(
    card: TitleCard,
    action: RateAction,
): { card: TitleCard; snapshot: RateSnapshot } {
    const snapshot: RateSnapshot = { card };
    switch (action.type) {
        case 'create':
            return {
                card: { ...card, userRate: { id: OPTIMISTIC_RATE_ID, status: action.status } },
                snapshot,
            };
        case 'update':
            return {
                card: {
                    ...card,
                    userRate: {
                        id: card.userRate?.id ?? OPTIMISTIC_RATE_ID,
                        status: action.status,
                    },
                },
                snapshot,
            };
        case 'delete':
            return { card: { ...card, userRate: null }, snapshot };
    }
}

export function rollbackRateAction(snapshot: RateSnapshot): TitleCard {
    return snapshot.card;
}

// --- Composable: optimistic user_rate writes over the search items (US-3) ---

export interface UseRates {
    // rateKey(card) values with a write in flight: their actions are locked in the UI.
    busyIds: Ref<Set<string>>;
    // rateKey(card) -> inline warning text (revoked edit access, docs/05).
    warnings: Ref<Map<string, string>>;
    performAction: (card: TitleCard, action: RateAction) => Promise<void>;
}

// Per-card key of busyIds/warnings (Ф4-5b). Anime and manga ids are independent
// sequences: a bare-id key let the finally of an in-flight anime write release
// the busy lock of a manga twin taken after a type switch, allowing a parallel
// second write. UI consumers must use this same key for lookups.
export function rateKey(card: Pick<TitleCard, 'id' | 'targetType'>): string {
    return `${card.targetType}:${card.id}`;
}

type ActionResult = { ok: true; rate: UserRateRef | null } | { ok: false; error: ApiError };

// A token revoke returns 401 (confirmed by the owner 2026-07-23, docs/03), so
// the 'unauthorized' branch drives the lazy inline warning. The 403 branch is
// dead but kept as a defensive guard for a possible scope-only rejection.
// Exported: use-lists applies the same policy to list rows.
export function isEditForbidden(error: ApiError): boolean {
    return error.kind === 'unauthorized' || (error.kind === 'api' && error.status === 403);
}

// Exported: shared with use-lists.
export function failureToast(error: ApiError): string {
    // 422 carries a validation message extracted by http.ts — more useful than
    // the generic "api" text.
    if (error.kind === 'api' && error.status === 422 && error.message) {
        return error.message;
    }
    return apiErrorMessage(error);
}

// Instance-based (unlike the module-level use-auth/use-search): the state is
// bound to the items list it patches, which the owner passes in.
export function useRates(items: Ref<TitleCard[]>, showToast: (text: string) => void): UseRates {
    const busyIds = ref(new Set<string>());
    const warnings = ref(new Map<string, string>());

    // A replaced list (new search response, cache restore, re-login) invalidates
    // per-card UI state: without this a card with the same rateKey would resurrect
    // a stale "no access" warning. Fires on array reference change only — our own
    // in-place setUserRate patches do not re-trigger it.
    watch(items, () => {
        busyIds.value.clear();
        warnings.value.clear();
    });

    // Anime and manga ids are independent sequences, so a card is addressed by
    // (id, targetType) — an id match alone could patch a title of the other
    // media after a type switch replaced the list mid-flight.
    function setUserRate(card: TitleCard, rate: UserRateRef | null): void {
        // The card may be gone if a new search replaced the results mid-flight.
        const index = items.value.findIndex(
            (item) => item.id === card.id && item.targetType === card.targetType,
        );
        if (index !== -1) {
            items.value[index] = { ...items.value[index], userRate: rate };
        }
    }

    async function dispatchAction(
        card: TitleCard,
        action: RateAction,
        rateId: string,
    ): Promise<ActionResult> {
        switch (action.type) {
            case 'create': {
                const response = await sendMessage('rates.create', {
                    targetId: card.id,
                    targetType: card.targetType,
                    status: action.status,
                });
                return response.ok ? { ok: true, rate: response.data.rate } : response;
            }
            case 'update': {
                const response = await sendMessage('rates.update', {
                    rateId,
                    patch: { status: action.status },
                });
                return response.ok ? { ok: true, rate: response.data.rate } : response;
            }
            case 'delete': {
                const response = await sendMessage('rates.delete', { rateId });
                return response.ok ? { ok: true, rate: null } : response;
            }
        }
    }

    // Serializes the read-modify-write cache updates (promise chain, same
    // pattern as the auth single-flight): parallel actions on different cards
    // must not lose each other's patches to a lost update.
    let lastSearchSync: Promise<void> = Promise.resolve();

    // Confirmed server state also lands in session.lastSearch — otherwise the
    // next popup open would render stale badges from the cache (docs/05).
    function syncLastSearch(card: TitleCard, rate: UserRateRef | null): Promise<void> {
        lastSearchSync = lastSearchSync.then(() => writeLastSearch(card, rate));
        return lastSearchSync;
    }

    // Never rejects, so the chain above survives any failure.
    async function writeLastSearch(card: TitleCard, rate: UserRateRef | null): Promise<void> {
        try {
            const cached = await getSession('lastSearch');
            if (!cached) {
                return;
            }
            const index = cached.items.findIndex(
                (item) => item.id === card.id && item.targetType === card.targetType,
            );
            if (index === -1) {
                return;
            }
            const nextItems = cached.items.slice();
            nextItems[index] = { ...nextItems[index], userRate: rate };
            await setSession('lastSearch', { ...cached, items: nextItems });
        } catch {
            // A cache write failure only costs the instant first render.
        }
    }

    async function performAction(card: TitleCard, action: RateAction): Promise<void> {
        const key = rateKey(card);
        if (busyIds.value.has(key)) {
            return; // one in-flight write per card
        }
        const rateId = card.userRate?.id ?? OPTIMISTIC_RATE_ID;
        if (action.type !== 'create' && rateId === OPTIMISTIC_RATE_ID) {
            return; // nothing to address on the server; busy-lock normally prevents this
        }
        const { card: optimistic, snapshot } = applyRateAction(card, action);
        busyIds.value.add(key);
        warnings.value.delete(key); // a new attempt clears the previous warning
        setUserRate(card, optimistic.userRate);
        try {
            const result = await dispatchAction(card, action, rateId);
            if (result.ok) {
                setUserRate(card, result.rate);
                await syncLastSearch(card, result.rate);
                return;
            }
            const { error } = result;
            if (isEditForbidden(error)) {
                // Lazy revoke detection (docs/04 §3): inline warning only — no
                // toast, no auth state re-read, no automatic retry.
                setUserRate(card, rollbackRateAction(snapshot).userRate);
                warnings.value.set(key, i18n.errors.editForbidden);
                return;
            }
            if (error.kind === 'api' && error.status === 404 && action.type !== 'create') {
                // The rate is already gone on the site: the title is simply not
                // in the list anymore — accept that instead of rolling back.
                setUserRate(card, null);
                await syncLastSearch(card, null);
                showToast(i18n.rates.alreadyRemoved);
                return;
            }
            setUserRate(card, rollbackRateAction(snapshot).userRate);
            showToast(failureToast(error));
        } finally {
            busyIds.value.delete(key);
        }
    }

    return { busyIds, warnings, performAction };
}
