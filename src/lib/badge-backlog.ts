// Pure badge layer (US-12, Ф11-9): what the icon counter is made of and how the
// number reads. No chrome.*, no storage, no clock — src/lib/badge.ts renders
// what this module shapes, and only that module talks to the browser.
//
// The rows are kept between ticks because the counter must react to a write made
// from the popup («счётчик гаснет по мере отметок прогресса», US-12) without a
// second request: the answer to "+1 episode" already carries the new progress,
// so the badge only needs to remember which row that progress belongs to.

// One title as the badge remembers it. `episodesAired` + `progress` are exactly
// what BacklogItem (src/lib/calendar-schedule.ts) needs, so countTitlesBehind()
// eats these rows as they are — the badge counts literally what the calendar
// prints. `rateId` is the identity a write comes back with (RateState.id): the
// popup edits rates, not titles, and nothing else here is read by anyone.
export interface BadgeRow {
    rateId: string;
    episodesAired: number;
    progress: number;
}

// Ceiling of the number on the icon. Four characters fit, but without a cap a
// backlog of 128 would render as «12» — a silent lie is worse than a rounded
// truth, so anything above shows «99+» (design decision of Ф11-9).
export const BADGE_MAX = 99;

// Empty text hides the badge entirely — that is the "nothing waits" state, and
// a «0» on the icon would read as a broken counter.
export function badgeText(count: number): string {
    if (count <= 0) {
        return '';
    }
    return count > BADGE_MAX ? `${BADGE_MAX}+` : String(count);
}

// New progress of one rate, as a write answered it. Returns the SAME array when
// nothing moved — neither the rate nor the value is ours — so the caller can
// skip a storage write and a redraw by identity.
export function withRateProgress(
    rows: readonly BadgeRow[],
    rateId: string,
    progress: number,
): readonly BadgeRow[] {
    const index = rows.findIndex((row) => row.rateId === rateId);
    if (index < 0 || rows[index]!.progress === progress) {
        return rows;
    }
    const next = [...rows];
    next[index] = { ...rows[index]!, progress };
    return next;
}

// The rate left the counted set: deleted from the lists, or moved to a status
// the poll does not read. Same identity contract as withRateProgress.
export function withoutRate(rows: readonly BadgeRow[], rateId: string): readonly BadgeRow[] {
    const next = rows.filter((row) => row.rateId !== rateId);
    return next.length === rows.length ? rows : next;
}

// Storage is untrusted input, exactly as with the airing snapshot: a row written
// by another build (or half-written) must not reach the arithmetic as NaN and
// put an invented number on the icon. A row that does not survive this is
// dropped, and the next tick rebuilds the whole list anyway.
export function sanitizeBadgeRows(value: unknown): BadgeRow[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const rows: BadgeRow[] = [];
    for (const raw of value as unknown[]) {
        if (typeof raw !== 'object' || raw === null) {
            continue;
        }
        const { rateId, episodesAired, progress } = raw as Partial<BadgeRow>;
        if (typeof rateId === 'string' && isCount(episodesAired) && isCount(progress)) {
            rows.push({ rateId, episodesAired, progress });
        }
    }
    return rows;
}

function isCount(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
