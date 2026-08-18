import { i18n } from './i18n';

// Pure scheduling and backlog layer of the ongoings calendar (phase 7) and of
// the badge counter on top of it (phase 11): grouping, ordering, formatting and
// the "how many aired episodes I have not taken" arithmetic — no chrome.*, no
// Vue, no network. "Now" is an argument rather than Date.now() so the output is
// deterministic and testable.

// The two numbers the backlog arithmetic needs, and nothing else. Split out of
// ScheduleItem so the background poll row (`AiredPollItem`, Ф11-8) — which knows
// no air date and no episode total — satisfies it structurally: the badge then
// counts literally the same `behind` the calendar row prints, and the two cannot
// drift apart (docs/06, owner's decision 3 of phase 11).
export interface BacklogItem {
    episodesAired: number;
    progress: number; // my watched episodes (userRate.episodes)
}

// Minimal shape the schedule needs. The full calendar row (`CalendarItem`,
// Ф7-5) adds the presentation fields (name, poster, rate ids) and satisfies
// this interface structurally — every function below is generic over T and
// hands the caller's own rows back untouched.
// Field names follow the existing rows: `progress` is my watched episodes
// (RateRow.progress), `episodes`/`episodesAired` come from the title itself
// (docs/03 «Календарь — эталонный запрос»).
export interface ScheduleItem extends BacklogItem {
    nextEpisodeAt: string | null; // ISO8601 with offset; null for ~8% of ongoings
    episodes: number; // total, 0 = unknown (One Piece)
}

export interface ScheduleEntry<T extends ScheduleItem> {
    item: T;
    // Local time as 'HH:MM'; null in the undated group. The raw ISO string
    // never leaves this module — parsing dates is not the UI's business.
    time: string | null;
    episode: number | null; // episodesAired + 1; null when the data contradicts itself
    episodesTotal: number | null; // null = unknown, the UI then omits «из N»
    behind: number | null; // aired episodes I have not watched yet, only when > 0
}

// Key of the trailing group: rows without a usable date. Exported so the UI can
// render it differently without matching on the label text.
export const UNDATED_DAY_KEY = 'undated';

export interface ScheduleDay<T extends ScheduleItem> {
    key: string; // local 'YYYY-MM-DD', or UNDATED_DAY_KEY
    label: string; // «Сегодня» / «Завтра» / «пн, 3 августа» / «Дата не объявлена»
    entries: ScheduleEntry<T>[];
}

// Both formatters use the runtime's local zone on purpose: the calendar answers
// "when do I watch it", which is a local-clock question. Built once — an
// Intl.DateTimeFormat per row is measurable on a 50-row list.
const TIME_FORMAT = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const DAY_FORMAT = new Intl.DateTimeFormat('ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
});

const MS_PER_DAY = 86_400_000;

function startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Local calendar day, not UTC: near midnight the two differ by a day, and the
// grouping must match the clock on the wall.
function dayKey(day: Date): string {
    const month = String(day.getMonth() + 1).padStart(2, '0');
    const date = String(day.getDate()).padStart(2, '0');
    return `${day.getFullYear()}-${month}-${date}`;
}

// Whole days between two local midnights. Rounding covers DST: on a shift day
// the difference is 23 or 25 hours and would otherwise floor to the wrong day.
function daysBetween(from: Date, to: Date): number {
    return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

function dayLabel(day: Date, today: Date): string {
    const diff = daysBetween(today, day);
    if (diff === 0) {
        return i18n.calendar.today;
    }
    if (diff === 1) {
        return i18n.calendar.tomorrow;
    }
    return DAY_FORMAT.format(day);
}

// null for both a missing and an unparsable date: server data is untrusted, and
// an Invalid Date would poison every comparison it takes part in.
function parseAt(value: string | null): Date | null {
    if (!value) {
        return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

// Aired episodes I have not marked as watched, or null when there is no
// backlog. Watching ahead of the airing (a rewatch, an off-by-one made on the
// site) is silent: only a real backlog is worth a line in the row and a number
// on the badge.
export function episodesBehind(item: BacklogItem): number | null {
    const behind = item.episodesAired - item.progress;
    return behind > 0 ? behind : null;
}

// The badge number (US-12): how many TITLES have aired episodes I have not
// taken. Deliberately not the sum of those episodes — on an account with a
// backlog that would burn a three-digit number permanently and read as a
// breakage (docs/06, owner's decision 3 of phase 11).
//
// Status-agnostic on purpose: the caller decides which rows it hands over, and
// the poll row carries no list status to filter on anyway (docs/03, «Опрос —
// эталонный запрос»).
export function countTitlesBehind(items: readonly BacklogItem[]): number {
    let count = 0;
    for (const item of items) {
        if (episodesBehind(item) !== null) {
            count += 1;
        }
    }
    return count;
}

function toEntry<T extends ScheduleItem>(item: T, at: Date | null): ScheduleEntry<T> {
    const episodesTotal = item.episodes > 0 ? item.episodes : null;
    const next = item.episodesAired + 1;
    return {
        item,
        time: at === null ? null : TIME_FORMAT.format(at),
        // Contradicting data (more aired than announced) hides the number
        // instead of showing «серия 13 из 12». With an unknown total the number
        // always stands: there is nothing to contradict.
        episode: episodesTotal !== null && next > episodesTotal ? null : next,
        episodesTotal,
        behind: episodesBehind(item),
    };
}

// Groups titles into local calendar days, ascending, with the undated rows last.
export function buildSchedule<T extends ScheduleItem>(
    items: readonly T[],
    now: Date,
): ScheduleDay<T>[] {
    const today = startOfDay(now);
    const byDay = new Map<string, { day: Date; rows: { at: number; entry: ScheduleEntry<T> }[] }>();
    const undated: ScheduleEntry<T>[] = [];

    for (const item of items) {
        const at = parseAt(item.nextEpisodeAt);
        // Anything before the start of today means the server has not moved the
        // episode forward yet. Such a row is not "past" but unknown, so it goes
        // to the undated group; an episode that already aired TODAY stays in
        // «Сегодня» — it is still the answer to "what airs today".
        if (at === null || at.getTime() < today.getTime()) {
            undated.push(toEntry(item, null));
            continue;
        }
        const day = startOfDay(at);
        const key = dayKey(day);
        const row = { at: at.getTime(), entry: toEntry(item, at) };
        const group = byDay.get(key);
        if (group) {
            group.rows.push(row);
        } else {
            byDay.set(key, { day, rows: [row] });
        }
    }

    const days = [...byDay.values()]
        .sort((a, b) => a.day.getTime() - b.day.getTime())
        .map(({ day, rows }) => ({
            key: dayKey(day),
            label: dayLabel(day, today),
            // Array.prototype.sort is stable (ES2019): titles airing at the same
            // minute keep the order the server returned them in.
            entries: rows.sort((a, b) => a.at - b.at).map((row) => row.entry),
        }));

    if (undated.length > 0) {
        days.push({ key: UNDATED_DAY_KEY, label: i18n.calendar.undated, entries: undated });
    }
    return days;
}
