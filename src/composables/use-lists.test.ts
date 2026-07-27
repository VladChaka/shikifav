import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { ref, watch } from 'vue';
import type { MessageHandlers } from '../lib/messaging';
import type { SessionState } from '../lib/storage';
import { i18n } from '../lib/i18n';
import type { ApiError, RatePatch, RateRow, RateState } from '../lib/api/types';
import type { UseLists } from './use-lists';

function row(rateId: string, overrides: Partial<RateRow> = {}): RateRow {
    return {
        rateId,
        targetId: `10${rateId}`,
        targetType: 'Anime',
        name: `Title ${rateId}`,
        russian: null,
        posterUrl: null,
        posterUrl2x: null,
        status: 'watching',
        score: 0,
        progress: 3,
        total: 12,
        ...overrides,
    };
}

function rateState(id: string, overrides: Partial<RateState> = {}): RateState {
    return {
        id,
        status: 'watching',
        score: 0,
        episodes: 0,
        chapters: 0,
        volumes: 0,
        ...overrides,
    };
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

type ListPage = { items: RateRow[]; hasMore: boolean };

// Drains the microtask queue plus one macrotask tick, so "nothing happened"
// assertions observe a settled state (no timer logic lives in use-lists).
function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function handlers(overrides: Partial<MessageHandlers>): MessageHandlers {
    return {
        ping: async () => ({ pong: true }),
        'auth.getState': async () => ({ status: 'anonymous' }),
        'auth.login': async () => ({
            user: { id: 1, nickname: 'tester', avatarUrl: '' },
        }),
        'auth.logout': async () => ({}),
        'search.titles': async () => ({ items: [] }),
        'rates.list': async () => ({ items: [], hasMore: false }),
        'rates.create': async () => ({ rate: { id: '100', status: 'planned' } }),
        'rates.update': async () => ({ rate: rateState('100') }),
        'rates.delete': async () => ({}),
        'rates.increment': async () => ({ rate: rateState('100') }),
        'settings.setOrigin': async () => ({}),
        ...overrides,
    };
}

interface Setup {
    lists: UseLists;
    storage: typeof import('../lib/storage');
    toasts: string[];
}

// The composable keeps shared module-level state, so every test builds a fresh
// module graph (pattern of use-search.test.ts). The optional session seed is
// written before useLists() starts its cache restore.
async function setup(
    overrides: Partial<MessageHandlers> = {},
    seedLastList?: SessionState['lastList'],
): Promise<Setup> {
    vi.resetModules();
    const messaging = await import('../lib/messaging');
    messaging.onMessage(handlers(overrides));
    const storage = await import('../lib/storage');
    if (seedLastList) {
        await storage.setSession('lastList', seedLastList);
    }
    const composable = await import('./use-lists');
    const toasts: string[] = [];
    const lists = composable.useLists((text) => toasts.push(text));
    return { lists, storage, toasts };
}

describe('use-lists', () => {
    beforeEach(() => {
        fakeBrowser.reset();
    });

    describe('pagination', () => {
        it('activate coalesces concurrent calls into one first-page request', async () => {
            const calls: { status: string; page: number }[] = [];
            const { lists } = await setup({
                'rates.list': async ({ status, page }) => {
                    calls.push({ status, page });
                    return { items: [row('1')], hasMore: false };
                },
            });

            lists.activate();
            lists.activate(); // a show during the in-flight load joins that load
            await vi.waitFor(() => expect(lists.listStatus.value).toBe('data'));
            expect(lists.items.value).toEqual([row('1')]);
            expect(lists.hasMore.value).toBe(false);
            expect(calls).toEqual([{ status: 'watching', page: 1 }]);
        });

        it('re-activating the tab refetches and drops a row changed on the site', async () => {
            // Ф3-6 regression: the once-per-popup activation gate kept a row
            // completed on the site in the «Смотрю» list until a filter change.
            let completedOnSite = false;
            const calls: number[] = [];
            const { lists } = await setup({
                'rates.list': async ({ page }) => {
                    calls.push(page);
                    return completedOnSite
                        ? { items: [row('2')], hasMore: false }
                        : { items: [row('1'), row('2')], hasMore: false };
                },
            });

            lists.activate();
            await vi.waitFor(() => expect(lists.items.value).toEqual([row('1'), row('2')]));

            completedOnSite = true; // the site moved row 1 out of «Смотрю»
            lists.activate(); // the tab is shown again (App re-fires on each show)
            await vi.waitFor(() => expect(lists.items.value).toEqual([row('2')]));
            expect(calls).toEqual([1, 1]); // two first-page loads, no paging
            expect(lists.listStatus.value).toBe('data');
        });

        it('loadMore appends the next page with exactly one request', async () => {
            const calls: number[] = [];
            const { lists } = await setup({
                'rates.list': async ({ page }) => {
                    calls.push(page);
                    return page === 1
                        ? { items: [row('1'), row('2')], hasMore: true }
                        : { items: [row('3')], hasMore: false };
                },
            });

            lists.activate();
            await vi.waitFor(() => expect(lists.listStatus.value).toBe('data'));

            lists.loadMore();
            await vi.waitFor(() =>
                expect(lists.items.value).toEqual([row('1'), row('2'), row('3')]),
            );
            expect(calls).toEqual([1, 2]); // append, not a reload
            expect(lists.hasMore.value).toBe(false);
            expect(lists.loadingMore.value).toBe(false);

            lists.loadMore(); // hasMore is false — nothing left to page
            await flush();
            expect(calls).toEqual([1, 2]);
        });

        it('drops repeated loadMore calls while a page is in flight', async () => {
            const secondPage = deferred<ListPage>();
            const calls: number[] = [];
            const { lists } = await setup({
                'rates.list': async ({ page }) => {
                    calls.push(page);
                    return page === 1 ? { items: [row('1')], hasMore: true } : secondPage.promise;
                },
            });

            lists.activate();
            await vi.waitFor(() => expect(lists.listStatus.value).toBe('data'));

            lists.loadMore();
            lists.loadMore(); // in flight — must be dropped
            await flush();
            expect(calls).toEqual([1, 2]);

            secondPage.resolve({ items: [row('2')], hasMore: false });
            await vi.waitFor(() => expect(lists.items.value).toEqual([row('1'), row('2')]));
            expect(lists.loadingMore.value).toBe(false);
        });

        it('changing the status filter resets the rows and reloads from page 1', async () => {
            const calls: { status: string; page: number }[] = [];
            const { lists } = await setup({
                'rates.list': async ({ status, page }) => {
                    calls.push({ status, page });
                    return status === 'watching'
                        ? { items: [row('1')], hasMore: true }
                        : { items: [row('2', { status: 'completed' })], hasMore: false };
                },
            });

            lists.activate();
            await vi.waitFor(() => expect(lists.items.value).toEqual([row('1')]));

            lists.setFilterStatus('completed');
            // The reset is synchronous: old rows leave before the response.
            expect(lists.items.value).toEqual([]);
            expect(lists.listStatus.value).toBe('skeleton');
            expect(lists.hasMore.value).toBe(false);

            await vi.waitFor(() =>
                expect(lists.items.value).toEqual([row('2', { status: 'completed' })]),
            );
            expect(calls).toEqual([
                { status: 'watching', page: 1 },
                { status: 'completed', page: 1 },
            ]);
        });

        it('drops a stale first-page response superseded by a filter change', async () => {
            const stale = deferred<ListPage>();
            const { lists } = await setup({
                'rates.list': async ({ status }) =>
                    status === 'watching'
                        ? stale.promise
                        : { items: [row('2', { status: 'completed' })], hasMore: false },
            });

            lists.activate();
            await flush(); // the watching request is in flight
            lists.setFilterStatus('completed');
            await vi.waitFor(() =>
                expect(lists.items.value).toEqual([row('2', { status: 'completed' })]),
            );

            stale.resolve({ items: [row('1')], hasMore: true }); // stale — must be dropped
            await flush();
            expect(lists.items.value).toEqual([row('2', { status: 'completed' })]);
            expect(lists.filterStatus.value).toBe('completed');
            expect(lists.hasMore.value).toBe(false);
            expect(lists.listStatus.value).toBe('data');
        });

        it('a superseded loadMore neither appends rows nor resets loadingMore of the newer load', async () => {
            const staleMore = deferred<ListPage>();
            const freshMore = deferred<ListPage>();
            const calls: string[] = [];
            const { lists } = await setup({
                'rates.list': async ({ status, page }) => {
                    calls.push(`${status}:${page}`);
                    if (status === 'watching' && page === 1) {
                        return { items: [row('w1')], hasMore: true };
                    }
                    if (status === 'watching' && page === 2) {
                        return staleMore.promise;
                    }
                    if (status === 'completed' && page === 1) {
                        return { items: [row('c1', { status: 'completed' })], hasMore: true };
                    }
                    return freshMore.promise;
                },
            });

            lists.activate();
            await vi.waitFor(() => expect(lists.items.value).toEqual([row('w1')]));
            lists.loadMore(); // stale page 2 in flight
            await vi.waitFor(() => expect(calls).toContain('watching:2'));

            lists.setFilterStatus('completed');
            await vi.waitFor(() =>
                expect(lists.items.value).toEqual([row('c1', { status: 'completed' })]),
            );
            lists.loadMore(); // fresh page 2 in flight
            await vi.waitFor(() => expect(calls).toContain('completed:2'));
            expect(lists.loadingMore.value).toBe(true);

            staleMore.resolve({ items: [row('w2')], hasMore: false });
            await flush();
            // The stale finally must not re-enable "Ещё" while the fresh page
            // is still loading (that would allow a duplicate page request).
            expect(lists.loadingMore.value).toBe(true);
            expect(lists.items.value).toEqual([row('c1', { status: 'completed' })]);
            expect(lists.hasMore.value).toBe(true);

            freshMore.resolve({ items: [row('c2', { status: 'completed' })], hasMore: false });
            await vi.waitFor(() =>
                expect(lists.items.value).toEqual([
                    row('c1', { status: 'completed' }),
                    row('c2', { status: 'completed' }),
                ]),
            );
            expect(lists.loadingMore.value).toBe(false);
            expect(lists.hasMore.value).toBe(false);
        });

        it('shows the error state and retry re-runs the first page load', async () => {
            let fail = true;
            const { lists } = await setup({
                'rates.list': async () => {
                    if (fail) {
                        throw { kind: 'network' } satisfies ApiError;
                    }
                    return { items: [row('1')], hasMore: false };
                },
            });

            lists.activate();
            await vi.waitFor(() => expect(lists.listStatus.value).toBe('error'));
            expect(lists.errorText.value).toBe(i18n.errors.network);

            fail = false;
            lists.retry();
            await vi.waitFor(() => expect(lists.listStatus.value).toBe('data'));
            expect(lists.items.value).toEqual([row('1')]);
            expect(lists.errorText.value).toBeUndefined();
        });
    });

    describe('per-row busy lock', () => {
        it('drops a second action on a row while the first is in flight', async () => {
            const increment = deferred<{ rate: RateState }>();
            let incrementCalls = 0;
            let updateCalls = 0;
            const { lists } = await setup({
                'rates.list': async () => ({ items: [row('1')], hasMore: false }),
                'rates.increment': async () => {
                    incrementCalls += 1;
                    return increment.promise;
                },
                'rates.update': async () => {
                    updateCalls += 1;
                    return { rate: rateState('1') };
                },
            });

            lists.activate();
            await vi.waitFor(() => expect(lists.listStatus.value).toBe('data'));

            lists.increment(lists.items.value[0]);
            expect(lists.busyIds.value.has('1')).toBe(true);
            expect(lists.items.value[0].progress).toBe(4); // optimistic, synchronous

            lists.increment(lists.items.value[0]); // busy — dropped
            lists.setScore(lists.items.value[0], 8); // busy — dropped too
            await flush();
            expect(incrementCalls).toBe(1);
            expect(updateCalls).toBe(0);
            expect(lists.items.value[0].score).toBe(0); // the dropped score never applied

            increment.resolve({ rate: rateState('1', { episodes: 4 }) });
            await vi.waitFor(() => expect(lists.busyIds.value.size).toBe(0));
            expect(lists.items.value[0].progress).toBe(4);
        });

        it('finishing a list reload keeps the busy lock of an in-flight row', async () => {
            // Regression: clearing busyIds on reload would unlock a row whose
            // write is still in flight and allow a parallel double increment.
            const increment = deferred<{ rate: RateState }>();
            let incrementCalls = 0;
            const listCalls: number[] = [];
            const { lists } = await setup({
                'rates.list': async ({ page }) => {
                    listCalls.push(page);
                    return { items: [row('1')], hasMore: false };
                },
                'rates.increment': async () => {
                    incrementCalls += 1;
                    return increment.promise;
                },
            });

            lists.activate();
            await vi.waitFor(() => expect(lists.listStatus.value).toBe('data'));

            lists.increment(lists.items.value[0]);
            expect(lists.items.value[0].progress).toBe(4);

            lists.retry(); // full first-page reload while the write is in flight
            await vi.waitFor(() => expect(listCalls).toEqual([1, 1]));
            await vi.waitFor(() => expect(lists.items.value[0].progress).toBe(3)); // fresh rows
            expect(lists.busyIds.value.has('1')).toBe(true); // still locked

            lists.increment(lists.items.value[0]); // must stay dropped
            await flush();
            expect(incrementCalls).toBe(1);

            increment.resolve({ rate: rateState('1', { episodes: 4 }) });
            await vi.waitFor(() => expect(lists.busyIds.value.size).toBe(0));
            expect(lists.items.value[0].progress).toBe(4); // reconciled with the server
        });
    });

    describe('increment (US-6)', () => {
        it('optimistically bumps progress and reconciles with the server state', async () => {
            const { lists, toasts } = await setup({
                'rates.list': async () => ({
                    items: [row('1', { progress: 3, total: 12 })],
                    hasMore: false,
                }),
                // The site already had more progress: the server value wins.
                'rates.increment': async () => ({
                    rate: rateState('1', { episodes: 5, score: 7 }),
                }),
            });

            lists.activate();
            await vi.waitFor(() => expect(lists.listStatus.value).toBe('data'));

            lists.increment(lists.items.value[0]);
            expect(lists.items.value[0].progress).toBe(4); // optimistic +1

            await vi.waitFor(() => expect(lists.items.value[0].progress).toBe(5));
            expect(lists.items.value[0].score).toBe(7); // RateState refreshes the row
            expect(lists.suggestIds.value.size).toBe(0); // 5 of 12 — no offer
            expect(toasts).toEqual([]);
        });

        it('rolls the progress back on failure without suggesting completion', async () => {
            const { lists, toasts } = await setup({
                'rates.list': async () => ({
                    items: [row('1', { progress: 11, total: 12 })],
                    hasMore: false,
                }),
                'rates.increment': async () => {
                    throw { kind: 'network' } satisfies ApiError;
                },
            });

            lists.activate();
            await vi.waitFor(() => expect(lists.listStatus.value).toBe('data'));

            lists.increment(lists.items.value[0]);
            expect(lists.items.value[0].progress).toBe(12); // optimistic

            await vi.waitFor(() => expect(lists.items.value[0].progress).toBe(11));
            expect(toasts).toEqual([i18n.errors.network]);
            // The optimistic value reached the total, but the server never
            // confirmed it — the offer must not appear.
            expect(lists.suggestIds.value.size).toBe(0);
        });

        it.each(['watching', 'rewatching'] as const)(
            'offers «Просмотрено?» when the server progress reaches a known total (%s)',
            async (status) => {
                const { lists } = await setup({
                    'rates.list': async () => ({
                        items: [row('1', { progress: 11, total: 12, status })],
                        hasMore: false,
                    }),
                    'rates.increment': async () => ({
                        rate: rateState('1', { episodes: 12, status }),
                    }),
                });

                lists.activate();
                await vi.waitFor(() => expect(lists.listStatus.value).toBe('data'));

                lists.increment(lists.items.value[0]);
                await vi.waitFor(() => expect(lists.suggestIds.value.has('1')).toBe(true));
                expect(lists.items.value[0].progress).toBe(12);
                // The status did NOT change automatically (US-6: offer only).
                expect(lists.items.value[0].status).toBe(status);
            },
        );

        it('never offers completion when the total is unknown (0)', async () => {
            const { lists } = await setup({
                'rates.list': async () => ({
                    items: [row('1', { progress: 11, total: 0 })],
                    hasMore: false,
                }),
                'rates.increment': async () => ({
                    rate: rateState('1', { episodes: 12 }),
                }),
            });

            lists.activate();
            await vi.waitFor(() => expect(lists.listStatus.value).toBe('data'));

            lists.increment(lists.items.value[0]);
            await vi.waitFor(() => expect(lists.items.value[0].progress).toBe(12));
            expect(lists.suggestIds.value.size).toBe(0);
        });

        it('drops the row without offering when the server flips the status out of the filter', async () => {
            // The site can auto-complete on the last episode: the increment
            // response carries status 'completed', outside the «Смотрю» filter.
            // Same rule as changeStatus (Ф3-8) — the row leaves, no US-6 offer.
            const { lists } = await setup({
                'rates.list': async () => ({
                    items: [row('1', { progress: 11, total: 12 })],
                    hasMore: false,
                }),
                'rates.increment': async () => ({
                    rate: rateState('1', { episodes: 12, status: 'completed' }),
                }),
            });

            lists.activate();
            await vi.waitFor(() => expect(lists.listStatus.value).toBe('data'));

            lists.increment(lists.items.value[0]);
            await vi.waitFor(() => expect(lists.busyIds.value.size).toBe(0));
            expect(lists.items.value).toEqual([]);
            expect(lists.listStatus.value).toBe('empty');
            expect(lists.suggestIds.value.size).toBe(0);
        });

        it('«Да» sends rates.update {status: completed} and the row leaves the filter', async () => {
            const updates: { rateId: string; patch: RatePatch }[] = [];
            const { lists } = await setup({
                'rates.list': async () => ({
                    items: [row('1', { progress: 11, total: 12 })],
                    hasMore: false,
                }),
                'rates.increment': async () => ({
                    rate: rateState('1', { episodes: 12 }),
                }),
                'rates.update': async ({ rateId, patch }) => {
                    updates.push({ rateId, patch });
                    return { rate: rateState('1', { episodes: 12, status: 'completed' }) };
                },
            });

            lists.activate();
            await vi.waitFor(() => expect(lists.listStatus.value).toBe('data'));
            lists.increment(lists.items.value[0]);
            await vi.waitFor(() => expect(lists.suggestIds.value.has('1')).toBe(true));

            lists.markCompleted(lists.items.value[0]);
            expect(lists.items.value[0].status).toBe('completed'); // optimistic, synchronous
            expect(lists.busyIds.value.has('1')).toBe(true);

            // Wait for the write to finish — the optimistic patch alone must
            // not be mistaken for completion (the row leaves on success only).
            await vi.waitFor(() => expect(lists.busyIds.value.size).toBe(0));
            expect(updates).toEqual([{ rateId: '1', patch: { status: 'completed' } }]);
            // Unified with the StatusMenu change (Ф3-8): the confirmed status
            // no longer matches the «Смотрю» filter, so the row is removed.
            expect(lists.items.value).toEqual([]);
            expect(lists.listStatus.value).toBe('empty');
            expect(lists.suggestIds.value.size).toBe(0);
        });

        it('applies the chapters progress from the server for a manga row', async () => {
            const { lists, toasts } = await setup({
                'rates.list': async () => ({
                    items: [row('1', { targetType: 'Manga', progress: 3, total: 40 })],
                    hasMore: false,
                }),
                // episodes carries a decoy value: a manga row must read chapters.
                'rates.increment': async () => ({
                    rate: rateState('1', { chapters: 7, episodes: 99 }),
                }),
            });

            lists.activate();
            await vi.waitFor(() => expect(lists.listStatus.value).toBe('data'));

            lists.increment(lists.items.value[0]);
            expect(lists.items.value[0].progress).toBe(4); // optimistic +1

            await vi.waitFor(() => expect(lists.items.value[0].progress).toBe(7));
            expect(lists.suggestIds.value.size).toBe(0); // 7 of 40 — no offer
            expect(toasts).toEqual([]);
        });

        it('offers completion when the server chapters reach the manga total', async () => {
            const { lists } = await setup({
                'rates.list': async () => ({
                    items: [row('1', { targetType: 'Manga', progress: 39, total: 40 })],
                    hasMore: false,
                }),
                // episodes stays 0: the offer must be driven by chapters.
                'rates.increment': async () => ({
                    rate: rateState('1', { chapters: 40 }),
                }),
            });

            lists.activate();
            await vi.waitFor(() => expect(lists.listStatus.value).toBe('data'));

            lists.increment(lists.items.value[0]);
            await vi.waitFor(() => expect(lists.suggestIds.value.has('1')).toBe(true));
            expect(lists.items.value[0].progress).toBe(40);
            // The status did NOT change automatically (US-6: offer only).
            expect(lists.items.value[0].status).toBe('watching');
        });

        it('«Позже» dismisses the offer locally without any request', async () => {
            let updateCalls = 0;
            const { lists } = await setup({
                'rates.list': async () => ({
                    items: [row('1', { progress: 11, total: 12 })],
                    hasMore: false,
                }),
                'rates.increment': async () => ({
                    rate: rateState('1', { episodes: 12 }),
                }),
                'rates.update': async () => {
                    updateCalls += 1;
                    return { rate: rateState('1') };
                },
            });

            lists.activate();
            await vi.waitFor(() => expect(lists.listStatus.value).toBe('data'));
            lists.increment(lists.items.value[0]);
            await vi.waitFor(() => expect(lists.suggestIds.value.has('1')).toBe(true));

            lists.dismissSuggest(lists.items.value[0]);
            await flush();
            expect(lists.suggestIds.value.size).toBe(0);
            expect(updateCalls).toBe(0);
            expect(lists.items.value[0].status).toBe('watching'); // no auto-transition
        });
    });

    describe('score (US-5)', () => {
        it('sends the score and keeps the server-confirmed value', async () => {
            const updates: { rateId: string; patch: RatePatch }[] = [];
            const { lists } = await setup({
                'rates.list': async () => ({ items: [row('1')], hasMore: false }),
                'rates.update': async ({ rateId, patch }) => {
                    updates.push({ rateId, patch });
                    return { rate: rateState('1', { score: 8, episodes: 3 }) };
                },
            });

            lists.activate();
            await vi.waitFor(() => expect(lists.listStatus.value).toBe('data'));

            lists.setScore(lists.items.value[0], 8);
            expect(lists.items.value[0].score).toBe(8); // optimistic, synchronous

            await vi.waitFor(() => expect(lists.busyIds.value.size).toBe(0));
            expect(updates).toEqual([{ rateId: '1', patch: { score: 8 } }]);
            expect(lists.items.value[0].score).toBe(8);
        });

        it('score 0 (remove) reaches the payload and clears the value', async () => {
            const updates: { rateId: string; patch: RatePatch }[] = [];
            const { lists } = await setup({
                'rates.list': async () => ({
                    items: [row('1', { score: 7 })],
                    hasMore: false,
                }),
                'rates.update': async ({ rateId, patch }) => {
                    updates.push({ rateId, patch });
                    return { rate: rateState('1', { score: 0, episodes: 3 }) };
                },
            });

            lists.activate();
            await vi.waitFor(() => expect(lists.listStatus.value).toBe('data'));

            lists.setScore(lists.items.value[0], 0);
            await vi.waitFor(() => expect(lists.busyIds.value.size).toBe(0));
            // 0 is falsy but must be sent — it is the "remove score" value.
            expect(updates).toEqual([{ rateId: '1', patch: { score: 0 } }]);
            expect(lists.items.value[0].score).toBe(0);
        });

        it('rolls the score back on failure with a toast', async () => {
            const { lists, toasts } = await setup({
                'rates.list': async () => ({
                    items: [row('1', { score: 7 })],
                    hasMore: false,
                }),
                'rates.update': async () => {
                    throw { kind: 'rate_limited', retryAfterMs: 3000 } satisfies ApiError;
                },
            });

            lists.activate();
            await vi.waitFor(() => expect(lists.listStatus.value).toBe('data'));

            lists.setScore(lists.items.value[0], 3);
            expect(lists.items.value[0].score).toBe(3); // optimistic

            await vi.waitFor(() => expect(lists.items.value[0].score).toBe(7));
            expect(toasts).toEqual([i18n.errors.rateLimited]);
            expect(lists.warnings.value.size).toBe(0);
        });
    });

    describe('row status actions (Ф3-8)', () => {
        it('optimistically flips the badge, locks the row, and drops it once the server confirms a status outside the filter', async () => {
            const update = deferred<{ rate: RateState }>();
            const updates: { rateId: string; patch: RatePatch }[] = [];
            const { lists } = await setup({
                'rates.list': async () => ({ items: [row('1')], hasMore: false }),
                'rates.update': async ({ rateId, patch }) => {
                    updates.push({ rateId, patch });
                    return update.promise;
                },
            });

            lists.activate();
            await vi.waitFor(() => expect(lists.listStatus.value).toBe('data'));

            lists.changeStatus(lists.items.value[0], 'dropped');
            expect(lists.items.value[0].status).toBe('dropped'); // optimistic, synchronous
            expect(lists.busyIds.value.has('1')).toBe(true);

            await vi.waitFor(() =>
                expect(updates).toEqual([{ rateId: '1', patch: { status: 'dropped' } }]),
            );
            expect(lists.items.value).toHaveLength(1); // still visible while the write is in flight

            update.resolve({ rate: rateState('1', { status: 'dropped' }) });
            await vi.waitFor(() => expect(lists.busyIds.value.size).toBe(0));
            // 'dropped' is outside the «Смотрю» filter → the row leaves the list.
            expect(lists.items.value).toEqual([]);
            expect(lists.listStatus.value).toBe('empty');
        });

        it('removes only the changed row and keeps the sibling rows in the filter', async () => {
            const { lists } = await setup({
                'rates.list': async () => ({ items: [row('1'), row('2')], hasMore: false }),
                'rates.update': async () => ({ rate: rateState('1', { status: 'dropped' }) }),
            });

            lists.activate();
            await vi.waitFor(() => expect(lists.items.value).toEqual([row('1'), row('2')]));

            lists.changeStatus(lists.items.value[0], 'dropped');
            await vi.waitFor(() => expect(lists.items.value).toEqual([row('2')]));
            expect(lists.listStatus.value).toBe('data'); // the sibling keeps the list non-empty
            expect(lists.busyIds.value.size).toBe(0);
        });

        it('keeps and patches the row when the confirmed status still matches the filter', async () => {
            const { lists } = await setup({
                'rates.list': async ({ status }) =>
                    status === 'planned'
                        ? { items: [row('1', { status: 'planned' })], hasMore: false }
                        : { items: [row('seed')], hasMore: false },
                'rates.update': async () => ({ rate: rateState('1', { status: 'planned' }) }),
            });

            lists.activate();
            await vi.waitFor(() => expect(lists.listStatus.value).toBe('data'));
            lists.setFilterStatus('planned');
            await vi.waitFor(() =>
                expect(lists.items.value).toEqual([row('1', { status: 'planned' })]),
            );

            // The confirmed status equals the active filter → the row stays (patchRow),
            // it is not removed.
            lists.changeStatus(lists.items.value[0], 'planned');
            await vi.waitFor(() => expect(lists.busyIds.value.size).toBe(0));
            expect(lists.items.value).toEqual([row('1', { status: 'planned' })]);
            expect(lists.listStatus.value).toBe('data');
        });

        it('rolls the status back to the original and toasts on a non-404 failure', async () => {
            const { lists, toasts } = await setup({
                'rates.list': async () => ({ items: [row('1')], hasMore: false }),
                'rates.update': async () => {
                    throw { kind: 'api', status: 500, message: 'Server Error' } satisfies ApiError;
                },
            });

            lists.activate();
            await vi.waitFor(() => expect(lists.listStatus.value).toBe('data'));

            lists.changeStatus(lists.items.value[0], 'dropped');
            expect(lists.items.value[0].status).toBe('dropped'); // optimistic

            await vi.waitFor(() => expect(lists.items.value[0].status).toBe('watching')); // rolled back
            expect(lists.items.value).toHaveLength(1); // the row stays on the list
            expect(toasts).toEqual([i18n.errors.api]);
            expect(lists.busyIds.value.size).toBe(0);
            expect(lists.warnings.value.size).toBe(0);
        });

        it('a manual status change drops a pending US-6 offer on the row', async () => {
            const { lists } = await setup({
                'rates.list': async () => ({
                    items: [row('1', { progress: 11, total: 12 })],
                    hasMore: false,
                }),
                'rates.increment': async () => ({ rate: rateState('1', { episodes: 12 }) }),
                'rates.update': async () => ({
                    rate: rateState('1', { episodes: 12, status: 'dropped' }),
                }),
            });

            lists.activate();
            await vi.waitFor(() => expect(lists.listStatus.value).toBe('data'));

            lists.increment(lists.items.value[0]); // reaches the total → the offer appears
            await vi.waitFor(() => expect(lists.suggestIds.value.has('1')).toBe(true));

            // Picking any status from the StatusMenu supersedes the offer.
            lists.changeStatus(lists.items.value[0], 'dropped');
            await vi.waitFor(() => expect(lists.items.value).toEqual([])); // 'dropped' leaves «Смотрю»
            expect(lists.suggestIds.value.has('1')).toBe(false);
        });

        it('deletes server-first: no optimistic removal, row locked, gone on confirmation', async () => {
            const del = deferred<Record<string, never>>();
            const deletes: string[] = [];
            const { lists } = await setup({
                'rates.list': async () => ({ items: [row('1')], hasMore: false }),
                'rates.delete': async ({ rateId }) => {
                    deletes.push(rateId);
                    return del.promise;
                },
            });

            lists.activate();
            await vi.waitFor(() => expect(lists.listStatus.value).toBe('data'));

            lists.removeRate(lists.items.value[0]);
            expect(lists.items.value).toHaveLength(1); // no optimistic delete
            expect(lists.busyIds.value.has('1')).toBe(true); // but the row is locked

            await vi.waitFor(() => expect(deletes).toEqual(['1']));
            del.resolve({});
            await vi.waitFor(() => expect(lists.items.value).toEqual([]));
            expect(lists.listStatus.value).toBe('empty');
            expect(lists.busyIds.value.size).toBe(0);
        });

        it('drops the row and toasts «уже удалена» when delete returns 404', async () => {
            const { lists, toasts } = await setup({
                'rates.list': async () => ({ items: [row('1'), row('2')], hasMore: false }),
                'rates.delete': async () => {
                    throw { kind: 'api', status: 404, message: 'Not Found' } satisfies ApiError;
                },
            });

            lists.activate();
            await vi.waitFor(() => expect(lists.listStatus.value).toBe('data'));

            lists.removeRate(lists.items.value[0]);
            await vi.waitFor(() => expect(lists.items.value).toEqual([row('2')]));
            expect(toasts).toEqual([i18n.rates.alreadyRemoved]);
            expect(lists.listStatus.value).toBe('data'); // the sibling remains
            expect(lists.busyIds.value.size).toBe(0);
        });

        it('keeps the row and toasts on a non-404 delete failure', async () => {
            const { lists, toasts } = await setup({
                'rates.list': async () => ({ items: [row('1')], hasMore: false }),
                'rates.delete': async () => {
                    throw { kind: 'network' } satisfies ApiError;
                },
            });

            lists.activate();
            await vi.waitFor(() => expect(lists.listStatus.value).toBe('data'));

            lists.removeRate(lists.items.value[0]);
            await vi.waitFor(() => expect(lists.busyIds.value.size).toBe(0));
            expect(lists.items.value).toEqual([row('1')]); // no optimistic removal → row stays
            expect(toasts).toEqual([i18n.errors.network]);
            expect(lists.listStatus.value).toBe('data');
        });

        it('drops a second removeRate while the first delete is in flight', async () => {
            const del = deferred<Record<string, never>>();
            let deleteCalls = 0;
            const { lists } = await setup({
                'rates.list': async () => ({ items: [row('1')], hasMore: false }),
                'rates.delete': async () => {
                    deleteCalls += 1;
                    return del.promise;
                },
            });

            lists.activate();
            await vi.waitFor(() => expect(lists.listStatus.value).toBe('data'));

            lists.removeRate(lists.items.value[0]);
            lists.removeRate(lists.items.value[0]); // busy — dropped
            await flush();
            expect(deleteCalls).toBe(1);

            del.resolve({});
            await vi.waitFor(() => expect(lists.items.value).toEqual([]));
        });
    });

    describe('failure policies', () => {
        it('404 on an action removes the row and toasts «уже удалена»', async () => {
            const { lists, toasts } = await setup({
                'rates.list': async () => ({
                    items: [row('1'), row('2')],
                    hasMore: false,
                }),
                'rates.increment': async () => {
                    throw { kind: 'api', status: 404, message: 'Not Found' } satisfies ApiError;
                },
            });

            lists.activate();
            await vi.waitFor(() => expect(lists.listStatus.value).toBe('data'));

            lists.increment(lists.items.value[0]);
            await vi.waitFor(() => expect(lists.items.value).toEqual([row('2')]));
            expect(toasts).toEqual([i18n.rates.alreadyRemoved]);
            expect(lists.listStatus.value).toBe('data'); // the other row remains
            expect(lists.suggestIds.value.size).toBe(0);
            expect(lists.warnings.value.size).toBe(0);
            expect(lists.busyIds.value.size).toBe(0);
        });

        it('unauthorized rolls back with an inline warning and no toast; a retry clears it', async () => {
            let fail = true;
            const { lists, toasts } = await setup({
                'rates.list': async () => ({ items: [row('1')], hasMore: false }),
                'rates.increment': async () => {
                    if (fail) {
                        throw { kind: 'unauthorized' } satisfies ApiError;
                    }
                    return { rate: rateState('1', { episodes: 4 }) };
                },
            });

            lists.activate();
            await vi.waitFor(() => expect(lists.listStatus.value).toBe('data'));

            lists.increment(lists.items.value[0]);
            await vi.waitFor(() =>
                expect(lists.warnings.value.get('1')).toBe(i18n.errors.editForbidden),
            );
            expect(lists.items.value[0].progress).toBe(3); // rolled back
            expect(toasts).toEqual([]); // inline warning only (docs/04 §3)
            expect(lists.items.value).toHaveLength(1); // the row itself stays

            fail = false;
            lists.increment(lists.items.value[0]); // a new attempt clears the warning
            await vi.waitFor(() => expect(lists.items.value[0].progress).toBe(4));
            expect(lists.warnings.value.size).toBe(0);
        });
    });

    describe('session cache', () => {
        it('restores rows and the filter from session.lastList before the network', async () => {
            const cached = row('1', { status: 'completed', progress: 12 });
            const firstPage = deferred<ListPage>();
            const calls: { status: string; page: number }[] = [];
            const { lists } = await setup(
                {
                    'rates.list': async ({ status, page }) => {
                        calls.push({ status, page });
                        return firstPage.promise;
                    },
                },
                {
                    type: 'anime',
                    status: 'completed',
                    items: [cached],
                    page: 2,
                    hasMore: true,
                },
            );

            await vi.waitFor(() => expect(lists.items.value).toEqual([cached]));
            expect(lists.listStatus.value).toBe('data'); // instant render, no skeleton
            expect(lists.filterStatus.value).toBe('completed');
            expect(lists.hasMore.value).toBe(true);
            expect(calls).toEqual([]); // nothing hit the network yet

            lists.activate();
            await vi.waitFor(() => expect(calls).toEqual([{ status: 'completed', page: 1 }]));
            // Cached rows stay visible while the refresh is in flight.
            expect(lists.items.value).toEqual([cached]);
            expect(lists.listStatus.value).toBe('data');

            const fresh = row('2', { status: 'completed' });
            firstPage.resolve({ items: [fresh], hasMore: false });
            await vi.waitFor(() => expect(lists.items.value).toEqual([fresh]));
            expect(lists.hasMore.value).toBe(false);
        });

        it('popup started directly on the lists tab (App wiring) refreshes over the cache', async () => {
            // Ф3-6: wired exactly as App.vue — watch([authStatus, activeTab])
            // with immediate:true calling activate(), the lastTab restore and
            // the auth response both landing asynchronously after setup.
            const stale = row('stale');
            const firstPage = deferred<ListPage>();
            const calls: { status: string; page: number }[] = [];
            const { lists, storage } = await setup(
                {
                    'rates.list': async ({ status, page }) => {
                        calls.push({ status, page });
                        return firstPage.promise;
                    },
                },
                { type: 'anime', status: 'watching', items: [stale], page: 1, hasMore: false },
            );
            await storage.setSession('lastTab', 'lists');

            const authStatus = ref<'loading' | 'anonymous' | 'authorized'>('loading');
            const activeTab = ref<'search' | 'lists'>('search');
            watch(
                [authStatus, activeTab],
                ([auth, tab]) => {
                    if (auth === 'authorized' && tab === 'lists') {
                        lists.activate();
                    }
                },
                { immediate: true },
            );
            void storage.getSession('lastTab').then((tab) => {
                if (tab) {
                    activeTab.value = tab;
                }
            });
            authStatus.value = 'authorized'; // auth.getState resolved

            // Cached rows render instantly, before the network answers.
            await vi.waitFor(() => expect(lists.items.value).toEqual([stale]));
            expect(lists.listStatus.value).toBe('data');
            // Exactly one network refresh goes out for the restored filter.
            await vi.waitFor(() => expect(calls).toEqual([{ status: 'watching', page: 1 }]));
            expect(lists.items.value).toEqual([stale]); // still cached while in flight

            firstPage.resolve({ items: [row('fresh')], hasMore: false });
            // The response replaces the rows: the stale cached row is gone.
            await vi.waitFor(() => expect(lists.items.value).toEqual([row('fresh')]));
            expect(lists.listStatus.value).toBe('data');
        });

        it('writes the confirmed state to session.lastList after an operation', async () => {
            const { lists, storage } = await setup({
                'rates.list': async () => ({ items: [row('1')], hasMore: false }),
                'rates.increment': async () => ({
                    rate: rateState('1', { episodes: 4 }),
                }),
            });

            lists.activate();
            await vi.waitFor(() => expect(lists.listStatus.value).toBe('data'));

            lists.increment(lists.items.value[0]);
            await vi.waitFor(async () => {
                expect(await storage.getSession('lastList')).toEqual({
                    type: 'anime',
                    status: 'watching',
                    items: [row('1', { progress: 4 })],
                    page: 1,
                    hasMore: false,
                });
            });
        });

        it('a failed session read still loads the first page (no eternal skeleton)', async () => {
            vi.resetModules();
            const testing = await import('wxt/testing');
            const messaging = await import('../lib/messaging');
            messaging.onMessage(
                handlers({
                    'rates.list': async () => ({ items: [row('1')], hasMore: false }),
                }),
            );
            const sessionGet = testing.fakeBrowser.storage.session.get;
            testing.fakeBrowser.storage.session.get = (() =>
                Promise.reject(new Error('session storage unavailable'))) as typeof sessionGet;
            try {
                const composable = await import('./use-lists');
                const lists = composable.useLists(() => {});
                lists.activate();
                await vi.waitFor(() => expect(lists.listStatus.value).toBe('data'));
                expect(lists.items.value).toEqual([row('1')]);
            } finally {
                testing.fakeBrowser.storage.session.get = sessionGet;
            }
        });
    });
});
