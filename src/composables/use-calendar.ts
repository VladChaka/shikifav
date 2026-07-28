import { computed, ref } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import { sendMessage } from '../lib/messaging';
import { applyPosters, fetchMissingPosters } from '../lib/poster-backfill';
import { getSession, setSession } from '../lib/storage';
import { apiErrorMessage } from '../lib/i18n';
import { buildSchedule } from '../lib/calendar-schedule';
import type { ScheduleDay } from '../lib/calendar-schedule';
import type { CalendarItem } from '../lib/api/types';

// «Календарь» tab (US-9, phase 7): the ongoings of my lists with the date of
// their next episode. Read-only by design (docs/06): no [+1], no score, no
// status change — hence no busy locks, no optimistic patches and no rollback
// state here; every write stays in «Мои списки». Data flows only through
// background messages (docs/02, ADR-1); grouping is the pure layer in
// src/lib/calendar-schedule.ts.
export type CalendarStatus = 'skeleton' | 'data' | 'empty' | 'error';

export interface UseCalendar {
    // Raw rows, exactly as the API/cache gave them. Exposed next to `days`
    // because the empty/skeleton decisions and the poster placeholders are about
    // rows, not groups.
    items: Ref<CalendarItem[]>;
    // Rows grouped into local days — what the tab renders.
    days: ComputedRef<ScheduleDay<CalendarItem>[]>;
    // Named `screenStatus`, not `status`: a calendar row carries its own
    // `status` (my list status badge), and one word for both in a template is a
    // guaranteed misread.
    screenStatus: Ref<CalendarStatus>;
    errorText: Ref<string | undefined>;
    // Called on every show of the tab (never at popup open — the calendar must
    // cost zero requests until it is looked at, docs/06). Each call refreshes
    // over the visible rows; concurrent calls coalesce.
    activate: () => void;
    retry: () => void;
}

// The calendar is anime-only: Manga has no nextEpisodeAt (docs/03), so there is
// no type selector on the tab and the poster backfill has one fixed type.
const POSTER_TYPE = 'anime';

// Module-level state: the popup is a single short-lived instance, so every
// component shares one calendar session (same pattern as use-lists/use-search).
const items = ref<CalendarItem[]>([]);
const screenStatus = ref<CalendarStatus>('skeleton');
const errorText = ref<string | undefined>(undefined);
// "Now" used for the grouping, refreshed whenever a new set of rows lands. Kept
// as reactive state instead of calling Date.now() inside the computed: a
// computed that reads the clock is cached against inputs that never change, so
// it would silently keep an old grouping. With this ref the dependency is
// explicit — and a re-activation after midnight regroups the same rows.
const groupedAt = ref(Date.now());

// THE trap of this feature: the session cache stores rows only, never the built
// schedule. Groups are derived here, at render time, from the current clock —
// a cached «Сегодня» group written yesterday would otherwise put yesterday's
// air time under today's header (docs/06 smoke: the midnight check).
const days = computed<ScheduleDay<CalendarItem>[]>(() =>
    buildSchedule(items.value, new Date(groupedAt.value)),
);

let initialized = false;
// True while an activate() refresh chain is running: shows of the tab during an
// in-flight load coalesce into that one calendar.list (limiter budget).
let refreshing = false;
// A load already ran (or is running): the async cache restore must not overwrite
// live rows when it finally resolves (as in use-lists).
let touched = false;
let restorePromise: Promise<void> = Promise.resolve();
// Monotonic id: only the response of the LAST load is applied; retry()
// invalidates whatever is in flight.
let requestSeq = 0;

const itemId = (item: CalendarItem): string => item.targetId;

// Every new set of rows also re-dates the grouping.
function setItems(next: CalendarItem[]): void {
    items.value = next;
    groupedAt.value = Date.now();
}

// Confirmed rows land in session.lastCalendar so the next popup open renders
// them instantly (docs/05); rows are copied to plain objects (all fields
// primitive) to avoid storing Vue proxies. Never throws — a failed write only
// costs the instant first frame next time.
async function writeCache(): Promise<void> {
    try {
        await setSession('lastCalendar', {
            items: items.value.map((item) => ({ ...item })),
            fetchedAt: Date.now(),
        });
    } catch {
        // A cache write failure only costs the instant first frame next open.
    }
}

// Instant first frame from the session cache. Deliberately no TTL check on
// `fetchedAt`: every activation refreshes anyway, so a staleness gate would only
// decide whether stale rows are shown WHILE the network runs — and showing them
// is the whole point. Never rejects (Ф6-23, docs/02): a storage failure just
// means no instant frame, the load below still fills the screen.
async function restoreCache(): Promise<void> {
    try {
        const cached = await getSession('lastCalendar');
        if (touched || !cached) {
            return;
        }
        setItems(cached.items);
        screenStatus.value = cached.items.length > 0 ? 'data' : 'empty';
    } catch {
        // A failed restore only skips the instant first frame.
    }
}

// Ф6-27, mirror of use-lists.fillPosters: the rows are already on screen, the
// posters GraphQL did not return are fetched in one REST batch and patched in
// afterwards. The patch is applied to the CURRENT list (which a newer refresh
// may have replaced — hence the seq guard) and written back to the cache.
// Failures are silent: the rows keep the local fallback image.
async function fillPosters(requestId: number, rows: CalendarItem[]): Promise<void> {
    const posters = await fetchMissingPosters(rows, POSTER_TYPE, itemId);
    if (requestId !== requestSeq) {
        return; // a reload superseded these rows
    }
    const patched = applyPosters(items.value, posters, itemId);
    if (patched === null) {
        return;
    }
    // Not setItems(): a poster url cannot move a row between days, so the
    // grouping date stays where the rows themselves put it.
    items.value = patched;
    void writeCache();
}

async function load(): Promise<void> {
    touched = true;
    const requestId = ++requestSeq;
    errorText.value = undefined;
    // Skeleton only when nothing is on screen; cached rows stay visible while
    // the network catches up (docs/05).
    screenStatus.value = items.value.length > 0 ? 'data' : 'skeleton';

    const response = await sendMessage('calendar.list');
    if (requestId !== requestSeq) {
        return; // a retry superseded this load
    }
    if (response.ok) {
        setItems(response.data.items);
        screenStatus.value = response.data.items.length > 0 ? 'data' : 'empty';
        void writeCache();
        void fillPosters(requestId, response.data.items);
    } else {
        // Keep whatever rows were on screen; retry re-runs this loader.
        errorText.value = apiErrorMessage(response.error);
        screenStatus.value = 'error';
    }
}

function activate(): void {
    if (refreshing) {
        return;
    }
    refreshing = true;
    // Let the cache restore settle the rows first, then refresh. Every show of
    // the tab refetches, without a TTL: the calendar is exactly the screen where
    // a stale «Сегодня» is worse than one extra request (phase 3 made the same
    // call for the lists, docs/06).
    void restorePromise
        .then(() => load())
        .finally(() => {
            refreshing = false;
        });
}

function retry(): void {
    void load();
}

export function useCalendar(): UseCalendar {
    if (!initialized) {
        initialized = true;
        restorePromise = restoreCache();
    }
    return { items, days, screenStatus, errorText, activate, retry };
}
