import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import type { MessageHandlers } from '../lib/messaging';
import type { SessionState } from '../lib/storage';
import { i18n } from '../lib/i18n';
import { UNDATED_DAY_KEY } from '../lib/calendar-schedule';
import type { ApiError, CalendarItem, RateState } from '../lib/api/types';
import type { UseCalendar } from './use-calendar';

function item(id: string, overrides: Partial<CalendarItem> = {}): CalendarItem {
    return {
        rateId: id,
        targetId: `10${id}`,
        name: `Title ${id}`,
        russian: null,
        status: 'watching',
        posterUrl: null,
        posterUrl2x: null,
        nextEpisodeAt: null,
        episodes: 12,
        episodesAired: 3,
        progress: 3,
        url: null,
        ...overrides,
    };
}

function rateState(id: string): RateState {
    return { id, status: 'watching', score: 0, episodes: 0, chapters: 0, volumes: 0 };
}

function deferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
} {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

type CalendarPage = { items: CalendarItem[] };

// Drains the microtask queue plus one macrotask tick, so "nothing happened"
// assertions observe a settled state (no timer logic lives in use-calendar).
function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function handlers(overrides: Partial<MessageHandlers>): MessageHandlers {
    return {
        ping: async () => ({ pong: true }),
        'auth.getState': async () => ({ status: 'anonymous' }),
        'auth.login': async () => ({ user: { id: 1, nickname: 'tester', avatarUrl: '' } }),
        'auth.logout': async () => ({}),
        'search.titles': async () => ({ items: [] }),
        'rates.list': async () => ({ items: [], hasMore: false }),
        'calendar.list': async () => ({ items: [] }),
        'posters.fetch': async () => ({ posters: {} }),
        'rates.create': async () => ({ rate: { id: '100', status: 'planned' } }),
        'rates.update': async () => ({ rate: rateState('100') }),
        'rates.delete': async () => ({}),
        'rates.increment': async () => ({ rate: rateState('100') }),
        'settings.setOrigin': async () => ({}),
        'analytics.track': async () => ({}),
        ...overrides,
    };
}

interface Setup {
    calendar: UseCalendar;
    storage: typeof import('../lib/storage');
}

// The composable keeps shared module-level state, so every test builds a fresh
// module graph (pattern of use-lists.test.ts). The optional session seed is
// written before useCalendar() starts its cache restore.
async function setup(
    overrides: Partial<MessageHandlers> = {},
    seedLastCalendar?: SessionState['lastCalendar'],
): Promise<Setup> {
    vi.resetModules();
    const messaging = await import('../lib/messaging');
    messaging.onMessage(handlers(overrides));
    const storage = await import('../lib/storage');
    if (seedLastCalendar) {
        await storage.setSession('lastCalendar', seedLastCalendar);
    }
    const composable = await import('./use-calendar');
    return { calendar: composable.useCalendar(), storage };
}

describe('use-calendar', () => {
    beforeEach(() => {
        fakeBrowser.reset();
    });

    describe('loading', () => {
        it('loads nothing until the tab is activated', async () => {
            const calls: number[] = [];
            const { calendar } = await setup({
                'calendar.list': async () => {
                    calls.push(1);
                    return { items: [item('1')] };
                },
            });

            await flush();
            expect(calls).toEqual([]); // opening the popup costs zero requests
            expect(calendar.screenStatus.value).toBe('skeleton');

            calendar.activate();
            await vi.waitFor(() => expect(calendar.screenStatus.value).toBe('data'));
            expect(calendar.items.value).toEqual([item('1')]);
        });

        it('coalesces concurrent activations into one request', async () => {
            const calls: number[] = [];
            const { calendar } = await setup({
                'calendar.list': async () => {
                    calls.push(1);
                    return { items: [item('1')] };
                },
            });

            calendar.activate();
            calendar.activate(); // a show during the in-flight load joins that load
            calendar.activate();
            await vi.waitFor(() => expect(calendar.screenStatus.value).toBe('data'));
            expect(calls).toHaveLength(1);
        });

        it('refetches on every activation, without a TTL', async () => {
            let airing = [item('1'), item('2')];
            const calls: number[] = [];
            const { calendar } = await setup({
                'calendar.list': async () => {
                    calls.push(1);
                    return { items: airing };
                },
            });

            calendar.activate();
            await vi.waitFor(() => expect(calendar.items.value).toHaveLength(2));

            airing = [item('2')]; // title 1 finished airing between the two shows
            calendar.activate(); // the tab is shown again (App re-fires on each show)
            await vi.waitFor(() => expect(calendar.items.value).toEqual([item('2')]));
            expect(calls).toHaveLength(2);
        });

        it('drops the response of a superseded load', async () => {
            const first = deferred<CalendarPage>();
            const second = deferred<CalendarPage>();
            const pages = [first.promise, second.promise];
            const { calendar } = await setup({
                'calendar.list': async () => pages.shift() ?? { items: [] },
            });

            calendar.activate();
            await vi.waitFor(() => expect(calendar.screenStatus.value).toBe('skeleton'));
            calendar.retry(); // invalidates the in-flight load

            second.resolve({ items: [item('fresh')] });
            await vi.waitFor(() => expect(calendar.items.value).toEqual([item('fresh')]));

            first.resolve({ items: [item('stale')] }); // late answer of the first load
            await flush();
            expect(calendar.items.value).toEqual([item('fresh')]);
            expect(calendar.screenStatus.value).toBe('data');
        });

        it('shows the empty state on an empty answer', async () => {
            const { calendar } = await setup({
                'calendar.list': async () => ({ items: [] }),
            });

            calendar.activate();
            await vi.waitFor(() => expect(calendar.screenStatus.value).toBe('empty'));
            expect(calendar.days.value).toEqual([]);
        });

        it('surfaces a failure as the error state and retries on demand', async () => {
            const error: ApiError = { kind: 'network' };
            let failing = true;
            const calls: number[] = [];
            const { calendar } = await setup({
                'calendar.list': async () => {
                    calls.push(1);
                    if (failing) {
                        throw error;
                    }
                    return { items: [item('1')] };
                },
            });

            calendar.activate();
            await vi.waitFor(() => expect(calendar.screenStatus.value).toBe('error'));
            expect(calendar.errorText.value).toBe(i18n.errors.network);

            failing = false;
            calendar.retry();
            await vi.waitFor(() => expect(calendar.screenStatus.value).toBe('data'));
            expect(calendar.items.value).toEqual([item('1')]);
            expect(calendar.errorText.value).toBeUndefined();
            expect(calls).toHaveLength(2);
        });
    });

    describe('session cache', () => {
        it('renders the cached rows before the network answers', async () => {
            const cached = item('1', { name: 'Cached' });
            const page = deferred<CalendarPage>();
            const calls: number[] = [];
            const { calendar } = await setup(
                {
                    'calendar.list': async () => {
                        calls.push(1);
                        return page.promise;
                    },
                },
                { items: [cached], fetchedAt: Date.now() },
            );

            await vi.waitFor(() => expect(calendar.items.value).toEqual([cached]));
            expect(calendar.screenStatus.value).toBe('data'); // instant frame, no skeleton
            expect(calls).toEqual([]); // nothing hit the network yet

            calendar.activate();
            await vi.waitFor(() => expect(calls).toHaveLength(1));
            // Cached rows stay on screen while the refresh is in flight.
            expect(calendar.items.value).toEqual([cached]);
            expect(calendar.screenStatus.value).toBe('data');

            const fresh = item('2', { name: 'Fresh' });
            page.resolve({ items: [fresh] });
            await vi.waitFor(() => expect(calendar.items.value).toEqual([fresh]));
        });

        it('writes the loaded rows to session.lastCalendar', async () => {
            const { calendar, storage } = await setup({
                'calendar.list': async () => ({ items: [item('1')] }),
            });

            calendar.activate();
            await vi.waitFor(() => expect(calendar.screenStatus.value).toBe('data'));
            const cached = await storage.getSession('lastCalendar');
            expect(cached?.items).toEqual([item('1')]);
            expect(typeof cached?.fetchedAt).toBe('number');
        });

        it('a failed session read still loads the rows (no eternal skeleton)', async () => {
            const sessionGet = fakeBrowser.storage.session.get;
            fakeBrowser.storage.session.get = (() =>
                Promise.reject(new Error('session storage unavailable'))) as typeof sessionGet;
            try {
                const { calendar } = await setup({
                    'calendar.list': async () => ({ items: [item('1')] }),
                });

                calendar.activate();
                await vi.waitFor(() => expect(calendar.screenStatus.value).toBe('data'));
                expect(calendar.items.value).toEqual([item('1')]);
            } finally {
                fakeBrowser.storage.session.get = sessionGet;
            }
        });

        it('a failed session write neither breaks the load nor leaks a rejection', async () => {
            const rejections: unknown[] = [];
            const onUnhandled = (reason: unknown): void => {
                rejections.push(reason);
            };
            process.on('unhandledRejection', onUnhandled);
            const sessionSet = fakeBrowser.storage.session.set;
            fakeBrowser.storage.session.set = (() =>
                Promise.reject(new Error('session storage unavailable'))) as typeof sessionSet;
            try {
                const { calendar } = await setup({
                    'calendar.list': async () => ({ items: [item('1')] }),
                });

                calendar.activate();
                await vi.waitFor(() => expect(calendar.screenStatus.value).toBe('data'));
                expect(calendar.items.value).toEqual([item('1')]);
                await flush();
                await flush();
                expect(rejections).toEqual([]);
            } finally {
                fakeBrowser.storage.session.set = sessionSet;
                process.off('unhandledRejection', onUnhandled);
            }
        });
    });

    describe('poster backfill', () => {
        const REST_POSTER = 'https://shikimori.io/uploads/poster/animes/1/main.jpg';

        it('patches the rows GraphQL returned without a poster and re-caches them', async () => {
            const asked: string[][] = [];
            const { calendar, storage } = await setup({
                'calendar.list': async () => ({
                    items: [item('1'), item('2', { posterUrl: 'https://cdn/2.jpg' })],
                }),
                'posters.fetch': async ({ type, ids }) => {
                    expect(type).toBe('anime'); // the calendar is anime-only
                    asked.push(ids);
                    return { posters: { '101': REST_POSTER } };
                },
            });

            calendar.activate();
            await vi.waitFor(() => expect(calendar.items.value[0].posterUrl).toBe(REST_POSTER));
            expect(asked).toEqual([['101']]); // only the row without a poster
            expect(calendar.items.value[1].posterUrl).toBe('https://cdn/2.jpg');
            await vi.waitFor(async () => {
                expect((await storage.getSession('lastCalendar'))?.items).toEqual(
                    calendar.items.value,
                );
            });
        });
    });

    describe('grouping against the clock', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('never puts a cached air time from yesterday under «Сегодня»', async () => {
            // Written while it really was today: 27 July, 20:00 local.
            const airsAt = new Date(2026, 6, 27, 20, 0).toISOString();
            const airing = item('1', { nextEpisodeAt: airsAt });
            const cache: SessionState['lastCalendar'] = { items: [airing], fetchedAt: Date.now() };

            vi.setSystemTime(new Date(2026, 6, 27, 12, 0));
            const sameDay = await setup({}, cache);
            await vi.waitFor(() => expect(sameDay.calendar.items.value).toHaveLength(1));
            expect(sameDay.calendar.days.value[0].label).toBe(i18n.calendar.today);

            // Next popup open, one day later, same cache: the group must be
            // rebuilt against the new clock, not restored from the snapshot.
            vi.setSystemTime(new Date(2026, 6, 28, 12, 0));
            const nextDay = await setup({}, cache);
            await vi.waitFor(() => expect(nextDay.calendar.items.value).toHaveLength(1));
            const days = nextDay.calendar.days.value;
            expect(days.map((day) => day.label)).not.toContain(i18n.calendar.today);
            expect(days[0].key).toBe(UNDATED_DAY_KEY);
        });

        it('regroups the rows when a refresh crosses midnight', async () => {
            const airsAt = new Date(2026, 6, 27, 20, 0).toISOString();
            const airing = item('1', { nextEpisodeAt: airsAt });

            vi.setSystemTime(new Date(2026, 6, 27, 12, 0));
            const { calendar } = await setup({
                'calendar.list': async () => ({ items: [airing] }),
            });

            calendar.activate();
            await vi.waitFor(() => expect(calendar.screenStatus.value).toBe('data'));
            expect(calendar.days.value[0].label).toBe(i18n.calendar.today);

            vi.setSystemTime(new Date(2026, 6, 28, 12, 0)); // the popup stayed open
            calendar.activate(); // the tab is shown again after midnight
            await vi.waitFor(() => expect(calendar.days.value[0].key).toBe(UNDATED_DAY_KEY));
            expect(calendar.days.value.map((day) => day.label)).not.toContain(i18n.calendar.today);
        });
    });
});
