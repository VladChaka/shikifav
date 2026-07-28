import { ref } from 'vue';
import type { Ref } from 'vue';
import { sendMessage } from '../lib/messaging';
import { applyPosters, fetchMissingPosters } from '../lib/poster-backfill';
import { DEFAULT_SETTINGS, getSession, getSettings, setSession } from '../lib/storage';
import { apiErrorMessage, i18n } from '../lib/i18n';
import { failureToast, isEditForbidden } from './use-rates';
import type {
    ApiError,
    RateRow,
    RateState,
    RateTargetType,
    SearchType,
    UserRateStatus,
} from '../lib/api/types';

// "Мои списки" tab (US-4/5/6 + Ф3-8 row actions): the list for a (type, status)
// filter with pagination, plus optimistic +1 / score / "completed?" / status
// change / removal mutations over the rows. A row whose server-confirmed status
// no longer matches the filter leaves the list (docs/05); removal is confirmed
// server-first (no optimistic delete). Data flows only through background
// messages (docs/02, ADR-1).
export type ListStatus = 'skeleton' | 'data' | 'empty' | 'error';

export interface UseLists {
    items: Ref<RateRow[]>;
    listStatus: Ref<ListStatus>;
    errorText: Ref<string | undefined>;
    hasMore: Ref<boolean>;
    loadingMore: Ref<boolean>;
    filterType: Ref<SearchType>;
    filterStatus: Ref<UserRateStatus>;
    // rateIds with a write in flight (locks the row) / showing the US-6 offer.
    busyIds: Ref<Set<string>>;
    suggestIds: Ref<Set<string>>;
    // rateId -> inline warning text (revoked edit access, docs/05), as in use-rates.
    warnings: Ref<Map<string, string>>;
    // Lazy first-page load: called on every show of the "Мои списки" tab, not
    // at popup open (docs/05). Each call refreshes over the visible rows so
    // site-side changes surface (docs/06); concurrent calls coalesce.
    activate: () => void;
    loadMore: () => void;
    retry: () => void;
    setFilterType: (type: SearchType) => void;
    setFilterStatus: (status: UserRateStatus) => void;
    increment: (row: RateRow) => void;
    setScore: (row: RateRow, value: number) => void;
    markCompleted: (row: RateRow) => void;
    changeStatus: (row: RateRow, status: UserRateStatus) => void;
    removeRate: (row: RateRow) => void;
    dismissSuggest: (row: RateRow) => void;
}

// Lists open on anime by default; Манга/Ранобэ are selectable in MyListsTab and
// listRates routes reads by the active filter type. There is no setting for the
// type — only for the status filter (docs/05).
const DEFAULT_TYPE: SearchType = 'anime';

// Module-level state: the popup is a single short-lived instance, so every
// component shares one lists session (same pattern as use-search/use-auth).
const items = ref<RateRow[]>([]);
const listStatus = ref<ListStatus>('skeleton');
const errorText = ref<string | undefined>(undefined);
const hasMore = ref(false);
const loadingMore = ref(false);
const filterType = ref<SearchType>(DEFAULT_TYPE);
// The status filter follows the `defaultListStatus` setting (Ф6-20), which is
// read asynchronously — so the ref opens on the default of that very setting
// («Смотрю») instead of a second hardcoded constant next to it.
const filterStatus = ref<UserRateStatus>(DEFAULT_SETTINGS.defaultListStatus);
const busyIds = ref(new Set<string>());
const suggestIds = ref(new Set<string>());
const warnings = ref(new Map<string, string>());

// Not reactive: the UI never renders the page number, only "Ещё" (hasMore).
let page = 1;

let initialized = false;
// True while an activate() refresh chain is running: shows of the tab during
// an in-flight load coalesce into that one rates.list (limiter budget).
let refreshing = false;
// User already changed a filter or triggered a load: the async start-state
// restore (session cache + settings) must not overwrite live state when it
// finally resolves (as in use-search).
let touched = false;
let restorePromise: Promise<void> = Promise.resolve();
// Monotonic id: only the response of the LAST first-page load is applied, and a
// filter change/retry invalidates any in-flight page (first page or "Ещё").
let requestSeq = 0;
// Provided by the owner (App): transport-level failures surface as toasts.
let showToastFn: (text: string) => void = () => {};

// Anime progress = episodes; manga/ranobe (phase 4) = chapters.
function progressOf(rate: RateState, targetType: RateTargetType): number {
    return targetType === 'Manga' ? rate.chapters : rate.episodes;
}

function findRow(rateId: string): RateRow | undefined {
    return items.value.find((row) => row.rateId === rateId);
}

// The rate no longer exists on the server (404 on a write, Ф2-7): the row and
// its per-row state simply leave the list.
function removeRow(rateId: string): void {
    items.value = items.value.filter((row) => row.rateId !== rateId);
    suggestIds.value.delete(rateId);
    warnings.value.delete(rateId);
    if (items.value.length === 0) {
        listStatus.value = 'empty';
    }
}

// In-place index assignment on the reactive array (tracked in Vue 3, same as
// use-rates.setUserRate); the pre-patch row object stays intact for rollback.
function patchRow(rateId: string, patch: Partial<RateRow>): void {
    const index = items.value.findIndex((row) => row.rateId === rateId);
    if (index !== -1) {
        items.value[index] = { ...items.value[index], ...patch };
    }
}

// US-6: offer «Просмотрено?» only when the (known) total is reached while still
// watching/rewatching. total == 0 means the maximum is unknown — never offer.
function maybeSuggest(
    rateId: string,
    total: number,
    progress: number,
    status: UserRateStatus,
): void {
    const active = status === 'watching' || status === 'rewatching';
    if (total > 0 && progress >= total && active) {
        suggestIds.value.add(rateId);
    }
}

// Confirmed state lands in session.lastList so the next popup open renders it
// instantly (docs/05); rows are copied to plain objects (all fields primitive)
// to avoid storing Vue proxies. Never throws — a cache miss only loses the
// instant first render.
async function writeCache(): Promise<void> {
    try {
        console.log(1, items.value);
        await setSession('lastList', {
            type: filterType.value,
            status: filterStatus.value,
            items: items.value.map((row) => ({ ...row })),
            page,
            hasMore: hasMore.value,
        });
    } catch {
        // A cache write failure only costs the instant first render next open.
    }
}

// Start state, in priority order (Ф6-20):
//   1. whatever the user already did — `touched`;
//   2. session.lastList — instant first render of the last-viewed filter and
//      rows (docs/05); a filter switched by hand last session is the fresher
//      intent, so it wins over the setting;
//   3. `defaultListStatus` from the settings.
// Both reads are awaited together, so the outcome cannot depend on which
// storage promise settles first, and activate() chains loadFirstPage on this
// promise — the first request always goes out with the final filter. Never
// rejects: a failed read must still fall through to the network load.
async function restoreStartState(): Promise<void> {
    try {
        const [settings, cached] = await Promise.all([getSettings(), getSession('lastList')]);
        if (touched) {
            return;
        }
        if (!cached) {
            filterStatus.value = settings.defaultListStatus;
            return;
        }
        filterType.value = cached.type;
        filterStatus.value = cached.status;
        console.log(2, cached.items);
        items.value = cached.items;
        page = cached.page;
        hasMore.value = cached.hasMore;
        listStatus.value = cached.items.length > 0 ? 'data' : 'empty';
    } catch {
        // A failed restore only skips the instant first render.
    }
}

const rowId = (row: RateRow): string => row.targetId;

// Ф6-27, mirror of use-search.fillPosters: the rows are already on screen, the
// posters GraphQL did not return are fetched in one REST batch and patched in
// afterwards. `rows` is the page that was just loaded (so an "Ещё" page does not
// re-ask for the ids of earlier pages), while the patch itself is applied to the
// current list — an optimistic edit made meanwhile must survive it. The patched
// list is written back to the session cache. Failures are silent: the rows keep
// the local fallback image.
async function fillPosters(requestId: number, rows: RateRow[], type: SearchType): Promise<void> {
    const posters = await fetchMissingPosters(rows, type, rowId);
    if (requestId !== requestSeq) {
        return; // a filter change / reload superseded this page
    }
    const patched = applyPosters(items.value, posters, rowId);
    if (patched === null) {
        return;
    }
    console.log(3, patched);
    items.value = patched;
    void writeCache();
}

async function loadFirstPage(): Promise<void> {
    touched = true;
    const requestId = ++requestSeq;
    const type = filterType.value;
    const status = filterStatus.value;
    errorText.value = undefined;
    // Skeleton only when nothing is on screen; cached rows stay visible while the
    // network catches up (docs/05).
    listStatus.value = items.value.length > 0 ? 'data' : 'skeleton';

    const response = await sendMessage('rates.list', { type, status, page: 1 });
    if (requestId !== requestSeq) {
        return; // a filter change / retry superseded this load
    }
    if (response.ok) {
        console.log(4, response.data.items);
        items.value = response.data.items;
        page = 1;
        hasMore.value = response.data.hasMore;
        listStatus.value = response.data.items.length > 0 ? 'data' : 'empty';
        // Fresh rows invalidate per-row display state. busyIds is deliberately
        // NOT cleared: each in-flight action releases its own lock in finally
        // (rateId is stable), while clearing here would unlock a row whose
        // write is still in flight and allow a parallel double increment.
        suggestIds.value.clear();
        warnings.value.clear();
        void writeCache();
        void fillPosters(requestId, response.data.items, type);
    } else {
        // Keep whatever rows were on screen; retry re-runs this loader.
        errorText.value = apiErrorMessage(response.error);
        listStatus.value = 'error';
    }
}

function loadMore(): void {
    if (loadingMore.value || !hasMore.value || listStatus.value !== 'data') {
        return; // one page in flight; nothing to page; not showing data
    }
    const requestId = requestSeq;
    loadingMore.value = true;
    const nextPage = page + 1;
    void (async () => {
        try {
            const response = await sendMessage('rates.list', {
                type: filterType.value,
                status: filterStatus.value,
                page: nextPage,
            });
            if (requestId !== requestSeq) {
                return; // a reload superseded this page — do not append stale rows
            }
            if (response.ok) {
                // Append, never replace (docs/06 pagination); exactly one request.
                console.log(5, [...items.value, ...response.data.items]);
                items.value = [...items.value, ...response.data.items];
                page = nextPage;
                hasMore.value = response.data.hasMore;
                void writeCache();
                void fillPosters(requestId, response.data.items, filterType.value);
            } else {
                // Keep the list and hasMore so "Ещё" stays available for a retry.
                showToastFn(failureToast(response.error));
            }
        } finally {
            // A superseded page must not reset the flag of a newer in-flight
            // load — that would re-enable "Ещё" and allow a duplicate page.
            if (requestId === requestSeq) {
                loadingMore.value = false;
            }
        }
    })();
}

function resetForNewFilter(): void {
    page = 1;
    items.value = [];
    hasMore.value = false;
    loadingMore.value = false;
    errorText.value = undefined;
    // busyIds intentionally not cleared — see loadFirstPage.
    suggestIds.value.clear();
    warnings.value.clear();
}

function setFilterType(type: SearchType): void {
    if (type === filterType.value) {
        return;
    }
    filterType.value = type;
    touched = true;
    resetForNewFilter();
    void loadFirstPage();
}

function setFilterStatus(status: UserRateStatus): void {
    if (status === filterStatus.value) {
        return;
    }
    filterStatus.value = status;
    touched = true;
    resetForNewFilter();
    void loadFirstPage();
}

function retry(): void {
    void loadFirstPage();
}

function activate(): void {
    if (refreshing) {
        return;
    }
    refreshing = true;
    // Let the cache restore settle the filter+rows first, then refresh. Every
    // show of the tab refetches (a once-per-popup gate would hide site-side
    // changes in a long-lived popup until a filter change — docs/06, Ф3).
    void restorePromise
        .then(() => loadFirstPage())
        .finally(() => {
            refreshing = false;
        });
}

// Per-row busy lock: a second action on the same row is dropped while the first
// is in flight, so no create/update race can happen (as in use-rates).
// Generic over the confirmed payload: updates carry a RateState, delete has
// none (T = null).
async function runRowAction<T>(
    rateId: string,
    optimistic: (row: RateRow) => Partial<RateRow>,
    send: () => Promise<{ ok: true; rate: T } | { ok: false; error: ApiError }>,
    onSuccess: (row: RateRow, rate: T) => void,
    rollback: (row: RateRow) => Partial<RateRow>,
): Promise<void> {
    if (busyIds.value.has(rateId)) {
        return;
    }
    const snapshot = findRow(rateId);
    if (!snapshot) {
        return; // the row is gone (list reloaded) — nothing to act on
    }
    busyIds.value.add(rateId);
    warnings.value.delete(rateId); // a new attempt clears the previous warning
    patchRow(rateId, optimistic(snapshot));
    try {
        const result = await send();
        if (result.ok) {
            onSuccess(snapshot, result.rate);
            void writeCache();
            return;
        }
        const { error } = result;
        if (isEditForbidden(error)) {
            // Lazy revoke detection (docs/04 §3): inline warning only — no
            // toast, no automatic retry (same policy as use-rates).
            patchRow(rateId, rollback(snapshot));
            warnings.value.set(rateId, i18n.errors.editForbidden);
            return;
        }
        if (error.kind === 'api' && error.status === 404) {
            // Already deleted on the site (Ф2-7): drop the row instead of
            // rolling back to a state the server no longer has.
            removeRow(rateId);
            showToastFn(i18n.rates.alreadyRemoved);
            void writeCache();
            return;
        }
        patchRow(rateId, rollback(snapshot));
        showToastFn(failureToast(error));
    } finally {
        busyIds.value.delete(rateId);
    }
}

async function sendUpdate(
    rateId: string,
    patch: { status?: UserRateStatus; score?: number },
): Promise<{ ok: true; rate: RateState } | { ok: false; error: ApiError }> {
    const response = await sendMessage('rates.update', { rateId, patch });
    return response.ok ? { ok: true, rate: response.data.rate } : response;
}

function increment(row: RateRow): void {
    const rateId = row.rateId;
    void runRowAction(
        rateId,
        (current) => ({ progress: current.progress + 1 }),
        async () => {
            const response = await sendMessage('rates.increment', { rateId });
            return response.ok ? { ok: true, rate: response.data.rate } : response;
        },
        (current, rate) => {
            if (rate.status !== current.status && rate.status !== filterStatus.value) {
                // The increment itself moved the title out of the current filter
                // (e.g. the site auto-completes on the last episode) — drop it like
                // a manual status change (docs/05), same rule as changeStatus. Both
                // guards matter: a status that merely differs from the filter but
                // did not change (a rewatching row shown under another filter) must
                // stay and still get the US-6 offer. No offer here — status left
                // watching/rewatching.
                removeRow(rateId); // also clears suggest/warning for the row
                return;
            }
            const progress = progressOf(rate, current.targetType);
            patchRow(rateId, { progress, status: rate.status, score: rate.score });
            // US-6 offer is driven by the server-confirmed progress/status.
            maybeSuggest(rateId, current.total, progress, rate.status);
        },
        (current) => ({ progress: current.progress }),
    );
}

function setScore(row: RateRow, value: number): void {
    const rateId = row.rateId;
    void runRowAction(
        rateId,
        () => ({ score: value }), // value 0 removes the score
        () => sendUpdate(rateId, { score: value }),
        (_current, rate) => patchRow(rateId, { score: rate.score }),
        (current) => ({ score: current.score }),
    );
}

// US-6 «Да»: accepting the offer is a plain status change to 'completed' with
// the same confirm semantics as the StatusMenu (Ф3-8) — under the «Смотрю»
// filter the row leaves the list once the server confirms (docs/05).
function markCompleted(row: RateRow): void {
    changeStatus(row, 'completed');
}

// Ф3-8: status picked in the row's StatusMenu. Optimistic badge update; the
// server-confirmed status decides whether the row stays — a status outside the
// current filter removes it from the list (docs/05). The US-6 offer is dropped
// either way: a manual status change supersedes it.
function changeStatus(row: RateRow, status: UserRateStatus): void {
    const rateId = row.rateId;
    void runRowAction(
        rateId,
        () => ({ status }),
        () => sendUpdate(rateId, { status }),
        (_current, rate) => {
            if (rate.status !== filterStatus.value) {
                removeRow(rateId); // also clears suggest/warning for the row
                return;
            }
            patchRow(rateId, { status: rate.status });
            suggestIds.value.delete(rateId);
        },
        (current) => ({ status: current.status }),
    );
}

async function sendDelete(
    rateId: string,
): Promise<{ ok: true; rate: null } | { ok: false; error: ApiError }> {
    const response = await sendMessage('rates.delete', { rateId });
    return response.ok ? { ok: true, rate: null } : response;
}

// Ф3-8 «Удалить из списка»: no optimistic removal — undoing a vanished row is
// worse than a short busy-lock wait, so the row leaves only on server
// confirmation. A 404 lands in runRowAction's shared path (row dropped +
// «уже удалена» toast), which is the right outcome for delete too.
function removeRate(row: RateRow): void {
    const rateId = row.rateId;
    void runRowAction(
        rateId,
        () => ({}),
        () => sendDelete(rateId),
        () => {
            removeRow(rateId);
        },
        () => ({}),
    );
}

// US-6 «Позже»: dismiss the offer locally, no request, no auto-transition.
function dismissSuggest(row: RateRow): void {
    suggestIds.value.delete(row.rateId);
}

export function useLists(showToast: (text: string) => void): UseLists {
    showToastFn = showToast;
    if (!initialized) {
        initialized = true;
        restorePromise = restoreStartState();
    }
    return {
        items,
        listStatus,
        errorText,
        hasMore,
        loadingMore,
        filterType,
        filterStatus,
        busyIds,
        suggestIds,
        warnings,
        activate,
        loadMore,
        retry,
        setFilterType,
        setFilterStatus,
        increment,
        setScore,
        markCompleted,
        changeStatus,
        removeRate,
        dismissSuggest,
    };
}
