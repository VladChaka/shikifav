import { ref, watch } from 'vue';
import type { Ref } from 'vue';
import { sendMessage } from '../lib/messaging';
import { getSession, setSession } from '../lib/storage';
import { apiErrorMessage, i18n } from '../lib/i18n';
import type {
    ApiError,
    RateTargetType,
    TitleCard,
    UserRateRef,
    UserRateStatus,
} from '../lib/api/types';

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
    // Cards with a write in flight: their actions are locked in the UI.
    busyIds: Ref<Set<string>>;
    // Card id -> inline warning text (revoked edit access, docs/05).
    warnings: Ref<Map<string, string>>;
    performAction: (card: TitleCard, action: RateAction) => Promise<void>;
}

// Fixed until the manga/ranobe search arrives (phase 4), same as SEARCH_TYPE
// in use-search.
const RATE_TARGET_TYPE: RateTargetType = 'Anime';

type ActionResult = { ok: true; rate: UserRateRef | null } | { ok: false; error: ApiError };

// The exact status code after a token revoke (401 vs 403) is not confirmed by
// the owner yet (docs/04 §3), so both map to the lazy inline warning.
function isEditForbidden(error: ApiError): boolean {
    return error.kind === 'unauthorized' || (error.kind === 'api' && error.status === 403);
}

function failureToast(error: ApiError): string {
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
    // per-card UI state: without this a card with the same id would resurrect a
    // stale "no access" warning. Fires on array reference change only — our own
    // in-place setUserRate patches do not re-trigger it.
    watch(items, () => {
        busyIds.value.clear();
        warnings.value.clear();
    });

    function setUserRate(cardId: string, rate: UserRateRef | null): void {
        // The card may be gone if a new search replaced the results mid-flight.
        const index = items.value.findIndex((item) => item.id === cardId);
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
                    targetType: RATE_TARGET_TYPE,
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
    function syncLastSearch(cardId: string, rate: UserRateRef | null): Promise<void> {
        lastSearchSync = lastSearchSync.then(() => writeLastSearch(cardId, rate));
        return lastSearchSync;
    }

    // Never rejects, so the chain above survives any failure.
    async function writeLastSearch(cardId: string, rate: UserRateRef | null): Promise<void> {
        try {
            const cached = await getSession('lastSearch');
            if (!cached) {
                return;
            }
            const index = cached.items.findIndex((item) => item.id === cardId);
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
        const cardId = card.id;
        if (busyIds.value.has(cardId)) {
            return; // one in-flight write per card
        }
        const rateId = card.userRate?.id ?? OPTIMISTIC_RATE_ID;
        if (action.type !== 'create' && rateId === OPTIMISTIC_RATE_ID) {
            return; // nothing to address on the server; busy-lock normally prevents this
        }
        const { card: optimistic, snapshot } = applyRateAction(card, action);
        busyIds.value.add(cardId);
        warnings.value.delete(cardId); // a new attempt clears the previous warning
        setUserRate(cardId, optimistic.userRate);
        try {
            const result = await dispatchAction(card, action, rateId);
            if (result.ok) {
                setUserRate(cardId, result.rate);
                await syncLastSearch(cardId, result.rate);
                return;
            }
            const { error } = result;
            if (isEditForbidden(error)) {
                // Lazy revoke detection (docs/04 §3): inline warning only — no
                // toast, no auth state re-read, no automatic retry.
                setUserRate(cardId, rollbackRateAction(snapshot).userRate);
                warnings.value.set(cardId, i18n.errors.editForbidden);
                return;
            }
            if (error.kind === 'api' && error.status === 404 && action.type !== 'create') {
                // The rate is already gone on the site: the title is simply not
                // in the list anymore — accept that instead of rolling back.
                setUserRate(cardId, null);
                await syncLastSearch(cardId, null);
                showToast(i18n.rates.alreadyRemoved);
                return;
            }
            setUserRate(cardId, rollbackRateAction(snapshot).userRate);
            showToast(failureToast(error));
        } finally {
            busyIds.value.delete(cardId);
        }
    }

    return { busyIds, warnings, performAction };
}
