import { describe, expect, it } from 'vitest';
import { buildSchedule, UNDATED_DAY_KEY, type ScheduleItem } from './calendar-schedule';

// Every date in this file is built from LOCAL parts and only then serialized to
// ISO, so the expectations hold in any timezone the suite runs in — exactly the
// way the API date («2026-08-02T17:15:00+03:00») is an instant, not a wall date.
function localIso(year: number, month: number, day: number, hour = 0, minute = 0): string {
    return new Date(year, month - 1, day, hour, minute).toISOString();
}

// A row richer than ScheduleItem: the calendar item of Ф7-5 will look like this,
// and the tests check it travels through the schedule untouched.
interface Row extends ScheduleItem {
    id: string;
}

function row(overrides: Partial<Row> = {}): Row {
    return {
        id: 'row',
        nextEpisodeAt: null,
        episodes: 12,
        episodesAired: 5,
        progress: 5,
        ...overrides,
    };
}

const NOW = new Date(2026, 6, 28, 12, 0); // 28 July 2026, 12:00 local

describe('buildSchedule', () => {
    it('returns no groups for an empty input', () => {
        expect(buildSchedule([], NOW)).toEqual([]);
    });

    it('hands the caller row back by reference', () => {
        const item = row({ id: 'one-piece', nextEpisodeAt: localIso(2026, 7, 28, 17, 15) });
        const [day] = buildSchedule([item], NOW);
        expect(day.entries[0].item).toBe(item);
    });

    describe('day grouping', () => {
        it('splits the midnight boundary into Сегодня and Завтра', () => {
            const days = buildSchedule(
                [
                    row({ id: 'late', nextEpisodeAt: localIso(2026, 7, 28, 23, 59) }),
                    row({ id: 'early', nextEpisodeAt: localIso(2026, 7, 29, 0, 1) }),
                ],
                NOW,
            );
            expect(days.map((day) => [day.key, day.label])).toEqual([
                ['2026-07-28', 'Сегодня'],
                ['2026-07-29', 'Завтра'],
            ]);
        });

        it('formats a farther day as weekday and date', () => {
            const days = buildSchedule(
                [row({ nextEpisodeAt: localIso(2026, 8, 3, 17, 15) })],
                new Date(2026, 6, 30, 12, 0),
            );
            expect(days).toHaveLength(1);
            expect(days[0].key).toBe('2026-08-03');
            expect(days[0].label).toBe('пн, 3 августа');
        });

        it('crosses the month boundary', () => {
            const days = buildSchedule(
                [
                    row({ id: 'aug', nextEpisodeAt: localIso(2026, 8, 2, 10, 0) }),
                    row({ id: 'jul', nextEpisodeAt: localIso(2026, 7, 31, 10, 0) }),
                ],
                new Date(2026, 6, 31, 12, 0), // 31 July
            );
            expect(days.map((day) => [day.key, day.label])).toEqual([
                ['2026-07-31', 'Сегодня'],
                ['2026-08-02', 'вс, 2 августа'],
            ]);
        });

        it('crosses the year boundary', () => {
            const days = buildSchedule(
                [row({ nextEpisodeAt: localIso(2027, 1, 2, 10, 0) })],
                new Date(2026, 11, 31, 23, 30),
            );
            expect(days[0].key).toBe('2027-01-02');
            expect(days[0].label).toBe('сб, 2 января');
        });

        it('keeps titles of one day in a single group', () => {
            const days = buildSchedule(
                [
                    row({ id: 'a', nextEpisodeAt: localIso(2026, 7, 29, 16, 0) }),
                    row({ id: 'b', nextEpisodeAt: localIso(2026, 7, 29, 21, 30) }),
                ],
                NOW,
            );
            expect(days).toHaveLength(1);
            expect(days[0].entries.map((entry) => entry.item.id)).toEqual(['a', 'b']);
        });
    });

    describe('dates in the past', () => {
        it('keeps an episode that already aired today in Сегодня', () => {
            const days = buildSchedule(
                [row({ nextEpisodeAt: localIso(2026, 7, 28, 3, 0) })], // aired at 03:00, now 12:00
                NOW,
            );
            expect(days.map((day) => day.label)).toEqual(['Сегодня']);
            expect(days[0].entries[0].time).toBe('03:00');
        });

        it('moves a yesterday date to the undated group (server lagging behind)', () => {
            const days = buildSchedule(
                [row({ nextEpisodeAt: localIso(2026, 7, 27, 23, 59) })],
                NOW,
            );
            expect(days).toHaveLength(1);
            expect(days[0].key).toBe(UNDATED_DAY_KEY);
            expect(days[0].label).toBe('Дата не объявлена');
            expect(days[0].entries[0].time).toBeNull();
        });
    });

    describe('rows without a date', () => {
        it('puts a null date into the undated group', () => {
            const days = buildSchedule([row({ nextEpisodeAt: null })], NOW);
            expect(days).toEqual([
                expect.objectContaining({ key: UNDATED_DAY_KEY, label: 'Дата не объявлена' }),
            ]);
            expect(days[0].entries[0].time).toBeNull();
        });

        it('treats an unparsable date as undated', () => {
            const days = buildSchedule([row({ nextEpisodeAt: 'скоро' })], NOW);
            expect(days[0].key).toBe(UNDATED_DAY_KEY);
        });

        it('keeps the undated group last and in the input order', () => {
            const days = buildSchedule(
                [
                    row({ id: 'no-date-1', nextEpisodeAt: null }),
                    row({ id: 'far', nextEpisodeAt: localIso(2026, 8, 3, 17, 15) }),
                    row({ id: 'no-date-2', nextEpisodeAt: null }),
                    row({ id: 'today', nextEpisodeAt: localIso(2026, 7, 28, 17, 15) }),
                ],
                NOW,
            );
            expect(days.map((day) => day.key)).toEqual([
                '2026-07-28',
                '2026-08-03',
                UNDATED_DAY_KEY,
            ]);
            expect(days[2].entries.map((entry) => entry.item.id)).toEqual([
                'no-date-1',
                'no-date-2',
            ]);
        });

        it('omits the undated group when every row has a date', () => {
            const days = buildSchedule([row({ nextEpisodeAt: localIso(2026, 7, 29, 16, 0) })], NOW);
            expect(days.map((day) => day.key)).toEqual(['2026-07-29']);
        });
    });

    describe('episode numbers', () => {
        it('numbers the next episode as episodesAired + 1', () => {
            const [day] = buildSchedule(
                [
                    row({
                        nextEpisodeAt: localIso(2026, 7, 29, 16, 0),
                        episodes: 12,
                        episodesAired: 5,
                    }),
                ],
                NOW,
            );
            expect(day.entries[0].episode).toBe(6);
            expect(day.entries[0].episodesTotal).toBe(12);
        });

        it('shows the number without a total when the total is unknown', () => {
            const [day] = buildSchedule(
                [
                    row({
                        nextEpisodeAt: localIso(2026, 8, 2, 17, 15),
                        episodes: 0, // One Piece
                        episodesAired: 1150,
                    }),
                ],
                NOW,
            );
            expect(day.entries[0].episode).toBe(1151);
            expect(day.entries[0].episodesTotal).toBeNull();
        });

        it('hides the number when more episodes aired than announced', () => {
            const [day] = buildSchedule(
                [
                    row({
                        nextEpisodeAt: localIso(2026, 7, 29, 16, 0),
                        episodes: 12,
                        episodesAired: 12,
                    }),
                ],
                NOW,
            );
            expect(day.entries[0].episode).toBeNull();
            expect(day.entries[0].episodesTotal).toBe(12);
        });

        it('keeps the number when the next episode is the last one', () => {
            const [day] = buildSchedule(
                [
                    row({
                        nextEpisodeAt: localIso(2026, 7, 29, 16, 0),
                        episodes: 12,
                        episodesAired: 11,
                    }),
                ],
                NOW,
            );
            expect(day.entries[0].episode).toBe(12);
        });

        it('numbers episodes of an undated row too', () => {
            const [day] = buildSchedule(
                [row({ nextEpisodeAt: null, episodes: 24, episodesAired: 7 })],
                NOW,
            );
            expect(day.entries[0]).toMatchObject({ episode: 8, episodesTotal: 24, time: null });
        });
    });

    describe('backlog', () => {
        it('reports how many aired episodes are unwatched', () => {
            const [day] = buildSchedule(
                [
                    row({
                        nextEpisodeAt: localIso(2026, 7, 29, 16, 0),
                        episodesAired: 9,
                        progress: 4,
                    }),
                ],
                NOW,
            );
            expect(day.entries[0].behind).toBe(5);
        });

        it('stays silent when the progress matches the airing', () => {
            const [day] = buildSchedule(
                [
                    row({
                        nextEpisodeAt: localIso(2026, 7, 29, 16, 0),
                        episodesAired: 9,
                        progress: 9,
                    }),
                ],
                NOW,
            );
            expect(day.entries[0].behind).toBeNull();
        });

        it('stays silent when the progress is ahead of the airing', () => {
            const [day] = buildSchedule(
                [
                    row({
                        nextEpisodeAt: localIso(2026, 7, 29, 16, 0),
                        episodesAired: 9,
                        progress: 11,
                    }),
                ],
                NOW,
            );
            expect(day.entries[0].behind).toBeNull();
        });
    });

    describe('time', () => {
        it('formats the local time with two digits', () => {
            const [day] = buildSchedule([row({ nextEpisodeAt: localIso(2026, 7, 29, 7, 5) })], NOW);
            expect(day.entries[0].time).toBe('07:05');
        });

        it('never exposes the raw ISO string', () => {
            const iso = localIso(2026, 7, 29, 16, 0);
            const [day] = buildSchedule([row({ nextEpisodeAt: iso })], NOW);
            expect(day.entries[0].time).toBe('16:00');
            expect(day.entries[0].time).not.toBe(iso);
        });
    });

    describe('ordering', () => {
        it('sorts entries inside a day by time', () => {
            const [day] = buildSchedule(
                [
                    row({ id: 'evening', nextEpisodeAt: localIso(2026, 7, 29, 21, 30) }),
                    row({ id: 'night', nextEpisodeAt: localIso(2026, 7, 29, 1, 5) }),
                    row({ id: 'afternoon', nextEpisodeAt: localIso(2026, 7, 29, 16, 0) }),
                ],
                NOW,
            );
            expect(day.entries.map((entry) => entry.item.id)).toEqual([
                'night',
                'afternoon',
                'evening',
            ]);
        });

        it('sorts days ascending regardless of the input order', () => {
            const days = buildSchedule(
                [
                    row({ id: 'far', nextEpisodeAt: localIso(2026, 8, 3, 17, 15) }),
                    row({ id: 'today', nextEpisodeAt: localIso(2026, 7, 28, 17, 15) }),
                    row({ id: 'tomorrow', nextEpisodeAt: localIso(2026, 7, 29, 16, 0) }),
                ],
                NOW,
            );
            expect(days.map((day) => day.key)).toEqual(['2026-07-28', '2026-07-29', '2026-08-03']);
        });

        it('is stable for titles airing at the same minute', () => {
            const at = localIso(2026, 7, 29, 16, 0);
            const [day] = buildSchedule(
                [
                    row({ id: 'first', nextEpisodeAt: at }),
                    row({ id: 'second', nextEpisodeAt: at }),
                    row({ id: 'third', nextEpisodeAt: at }),
                ],
                NOW,
            );
            expect(day.entries.map((entry) => entry.item.id)).toEqual(['first', 'second', 'third']);
        });
    });
});
