import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import type { MessageHandlers } from '../lib/messaging';
import type { LocalState, SessionState } from '../lib/storage';
import type { ApiError, TitleCard } from '../lib/api/types';
import type { UseSearch } from './use-search';

const DEBOUNCE_MS = 300;

function card(id: string, name: string): TitleCard {
    return {
        id,
        targetType: 'Anime',
        name,
        russian: null,
        kind: 'tv',
        score: 8,
        status: 'released',
        episodes: 12,
        episodesAired: 12,
        year: 2020,
        posterUrl: null,
        posterUrl2x: null,
        userRate: null,
    };
}

// Manga/ranobe search result: targetType 'Manga', chapters/volumes instead of
// the episode fields (US-7).
function mangaCard(id: string, name: string): TitleCard {
    return {
        id,
        targetType: 'Manga',
        name,
        russian: null,
        kind: 'manga',
        score: 8,
        status: 'released',
        chapters: 116,
        volumes: 27,
        year: 2001,
        posterUrl: null,
        posterUrl2x: null,
        userRate: null,
    };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
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
        'calendar.list': async () => ({ items: [] }),
        'posters.fetch': async () => ({ posters: {} }),
        'rates.create': async () => ({ rate: { id: '1', status: 'planned' } }),
        'rates.update': async () => ({
            rate: { id: '1', status: 'watching', score: 0, episodes: 0, chapters: 0, volumes: 0 },
        }),
        'rates.delete': async () => ({}),
        'rates.increment': async () => ({
            rate: { id: '1', status: 'watching', score: 0, episodes: 0, chapters: 0, volumes: 0 },
        }),
        'settings.setOrigin': async () => ({}),
        ...overrides,
    };
}

interface Setup {
    search: UseSearch;
    storage: typeof import('../lib/storage');
}

// The composable keeps shared module-level state, so every test builds a fresh
// module graph; handlers and storage go through the SAME graph's modules
// (pattern of use-auth.test.ts). The optional session seed is written before
// useSearch() runs its cache restore.
async function setup(
    overrides: Partial<MessageHandlers> = {},
    seedLastSearch?: SessionState['lastSearch'],
    seedSettings?: Partial<LocalState['settings']>,
): Promise<Setup> {
    vi.resetModules();
    const messaging = await import('../lib/messaging');
    messaging.onMessage(handlers(overrides));
    const storage = await import('../lib/storage');
    if (seedLastSearch) {
        await storage.setSession('lastSearch', seedLastSearch);
    }
    if (seedSettings) {
        await storage.setSettings(seedSettings);
    }
    const composable = await import('./use-search');
    return { search: composable.useSearch(), storage };
}

describe('use-search', () => {
    beforeEach(() => {
        fakeBrowser.reset();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('collapses a burst of inputs into a single debounced request', async () => {
        const queries: string[] = [];
        const { search } = await setup({
            'search.titles': async ({ query }) => {
                queries.push(query);
                return { items: [card('1', 'Frieren')] };
            },
        });

        search.setQuery('fr');
        await vi.advanceTimersByTimeAsync(100);
        search.setQuery('frie');
        await vi.advanceTimersByTimeAsync(100);
        search.setQuery('frieren');
        expect(queries).toEqual([]); // nothing fires before the debounce delay

        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
        expect(queries).toEqual(['frieren']);
        await vi.waitFor(() => expect(search.status.value).toBe('data'));
        expect(search.items.value).toEqual([card('1', 'Frieren')]);
    });

    it('does not hit the network for a query shorter than 2 characters', async () => {
        const queries: string[] = [];
        const { search } = await setup({
            'search.titles': async ({ query }) => {
                queries.push(query);
                return { items: [] };
            },
        });

        search.setQuery('f');
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 3);
        search.setQuery('  x  '); // trimmed length 1
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 3);

        expect(queries).toEqual([]);
        expect(search.status.value).toBe('idle');
    });

    it('ignores the in-flight response when the query is cleared', async () => {
        const first = deferred<{ items: TitleCard[] }>();
        const { search } = await setup({
            'search.titles': async () => first.promise,
        });

        search.setQuery('frieren');
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS); // request in flight
        expect(search.status.value).toBe('loading');

        search.setQuery('');
        expect(search.status.value).toBe('idle');

        first.resolve({ items: [card('1', 'Frieren')] });
        await vi.advanceTimersByTimeAsync(0);
        expect(search.status.value).toBe('idle');
        expect(search.items.value).toEqual([]);
    });

    it('drops a late response of an older request', async () => {
        const first = deferred<{ items: TitleCard[] }>();
        let call = 0;
        const { search } = await setup({
            'search.titles': async () => {
                call += 1;
                return call === 1 ? first.promise : { items: [card('2', 'Two')] };
            },
        });

        search.setQuery('one');
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS); // first request hangs
        search.setQuery('two');
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
        await vi.waitFor(() => expect(search.items.value).toEqual([card('2', 'Two')]));

        first.resolve({ items: [card('1', 'One')] }); // stale, must be dropped
        await vi.advanceTimersByTimeAsync(0);
        expect(search.items.value).toEqual([card('2', 'Two')]);
        expect(search.status.value).toBe('data');
    });

    it('keeps previous results during a repeat search instead of a skeleton', async () => {
        const second = deferred<{ items: TitleCard[] }>();
        let call = 0;
        const { search } = await setup({
            'search.titles': async () => {
                call += 1;
                return call === 1 ? { items: [card('1', 'One')] } : second.promise;
            },
        });

        search.setQuery('one');
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
        await vi.waitFor(() => expect(search.status.value).toBe('data'));

        search.setQuery('two');
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS); // second request in flight
        expect(search.status.value).toBe('data'); // old items stay, no skeleton
        expect(search.items.value).toEqual([card('1', 'One')]);

        second.resolve({ items: [card('2', 'Two')] });
        await vi.waitFor(() => expect(search.items.value).toEqual([card('2', 'Two')]));
    });

    it('stores a successful response in the session cache', async () => {
        const items = [card('1', 'Frieren')];
        const { search, storage } = await setup({
            'search.titles': async () => ({ items }),
        });

        search.setQuery('frieren');
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

        await vi.waitFor(async () => {
            expect(await storage.getSession('lastSearch')).toEqual({
                query: 'frieren',
                type: 'anime',
                items,
            });
        });
    });

    // Ф6-27: GraphQL returns no poster for part of the catalogue (all 18+ titles
    // among them). The cards are shown at once and the missing posters are
    // backfilled from REST afterwards, in one batch per page.
    describe('poster backfill (Ф6-27)', () => {
        const REST_POSTER = 'https://shikimori.io/system/animes/x96/2.jpg?1711979744';

        function withPoster(id: string, name: string): TitleCard {
            return {
                ...card(id, name),
                posterUrl: `https://shikimori.io/uploads/poster/animes/${id}/mini.webp`,
                posterUrl2x: `https://shikimori.io/uploads/poster/animes/${id}/mini@2x.webp`,
            };
        }

        it('asks for the empty posters in one batch and patches the answer in', async () => {
            const asked: { type: string; ids: string[] }[] = [];
            const { search, storage } = await setup({
                'search.titles': async () => ({
                    items: [withPoster('1', 'Has poster'), card('2', 'No poster')],
                }),
                'posters.fetch': async ({ type, ids }) => {
                    asked.push({ type, ids });
                    return { posters: { '2': REST_POSTER } };
                },
            });

            search.setQuery('frieren');
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
            await vi.waitFor(() => expect(search.items.value[1].posterUrl).toBe(REST_POSTER));

            // Only the poster-less title is in the batch, and it is ONE request.
            expect(asked).toEqual([{ type: 'anime', ids: ['2'] }]);
            // The card that had a poster keeps its GraphQL urls untouched.
            expect(search.items.value[0]).toEqual(withPoster('1', 'Has poster'));
            // The backfilled url survives in the session cache: otherwise the
            // pictures would vanish again on the next popup open.
            expect(await storage.getSession('lastSearch')).toEqual({
                query: 'frieren',
                type: 'anime',
                items: search.items.value,
            });
        });

        it('sends no request when every card came with a poster', async () => {
            const asked: string[][] = [];
            const { search } = await setup({
                'search.titles': async () => ({ items: [withPoster('1', 'Has poster')] }),
                'posters.fetch': async ({ ids }) => {
                    asked.push(ids);
                    return { posters: {} };
                },
            });

            search.setQuery('frieren');
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
            await vi.waitFor(() => expect(search.status.value).toBe('data'));
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

            expect(asked).toEqual([]); // no extra request on every search
        });

        it('leaves the poster empty when the backfill fails, without an error state', async () => {
            const { search } = await setup({
                'search.titles': async () => ({ items: [card('2', 'No poster')] }),
                'posters.fetch': async () => {
                    throw { kind: 'network' } satisfies ApiError;
                },
            });

            search.setQuery('frieren');
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
            await vi.waitFor(() => expect(search.status.value).toBe('data'));
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

            // The card falls back to the local placeholder image; the failure of
            // a background top-up is not a user-facing error (docs/05).
            expect(search.items.value).toEqual([card('2', 'No poster')]);
            expect(search.error.value).toBeUndefined();
            expect(search.status.value).toBe('data');
        });

        it('does not show the cards while the backfill is in flight', async () => {
            const gate = deferred<{ posters: Record<string, string> }>();
            const { search } = await setup({
                'search.titles': async () => ({ items: [card('2', 'No poster')] }),
                'posters.fetch': async () => gate.promise,
            });

            search.setQuery('frieren');
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
            // Results are on screen before the backfill answers.
            await vi.waitFor(() => expect(search.status.value).toBe('data'));
            expect(search.items.value).toEqual([card('2', 'No poster')]);

            gate.resolve({ posters: { '2': REST_POSTER } });
            await vi.waitFor(() => expect(search.items.value[0].posterUrl).toBe(REST_POSTER));
        });

        it('drops a backfill that belongs to a superseded search', async () => {
            const gate = deferred<{ posters: Record<string, string> }>();
            let call = 0;
            const { search } = await setup({
                'search.titles': async ({ query }) => ({ items: [card('2', query)] }),
                'posters.fetch': async () => {
                    call += 1;
                    return call === 1 ? gate.promise : { posters: {} };
                },
            });

            search.setQuery('one');
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
            await vi.waitFor(() => expect(search.items.value).toEqual([card('2', 'one')]));

            search.setQuery('two');
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
            await vi.waitFor(() => expect(search.items.value).toEqual([card('2', 'two')]));

            gate.resolve({ posters: { '2': REST_POSTER } }); // stale
            await vi.advanceTimersByTimeAsync(0);
            expect(search.items.value).toEqual([card('2', 'two')]);
        });

        it('backfills a session cache restored without posters', async () => {
            // A cache written before Ф6-27 (or one whose backfill failed) still
            // has empty posters, and a restore alone hits no network otherwise.
            const asked: string[][] = [];
            const { search, storage } = await setup(
                {
                    'posters.fetch': async ({ ids }) => {
                        asked.push(ids);
                        return { posters: { '2': REST_POSTER } };
                    },
                },
                { query: 'frieren', type: 'anime', items: [card('2', 'No poster')] },
            );

            await vi.waitFor(() => expect(search.items.value[0].posterUrl).toBe(REST_POSTER));
            expect(asked).toEqual([['2']]);
            expect((await storage.getSession('lastSearch'))?.items).toEqual(search.items.value);
        });
    });

    it('keeps previous items on error; retry repeats the failed query', async () => {
        const queries: string[] = [];
        let fail = false;
        const { search } = await setup({
            'search.titles': async ({ query }) => {
                queries.push(query);
                if (fail) {
                    throw { kind: 'network' } satisfies ApiError;
                }
                return { items: [card(query, query)] };
            },
        });

        search.setQuery('one');
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
        await vi.waitFor(() => expect(search.status.value).toBe('data'));

        fail = true;
        search.setQuery('two');
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
        await vi.waitFor(() => expect(search.status.value).toBe('error'));
        expect(search.error.value).toEqual({ kind: 'network' });
        expect(search.items.value).toEqual([card('one', 'one')]); // not wiped

        fail = false;
        search.retry();
        // Waiting on items: status flips to 'data' already at dispatch start
        // (stale items stay on screen), the response is what replaces them.
        await vi.waitFor(() => expect(search.items.value).toEqual([card('two', 'two')]));
        expect(queries).toEqual(['one', 'two', 'two']);
        expect(search.status.value).toBe('data');
    });

    it('restores the last search from the session cache without a network call', async () => {
        const queries: string[] = [];
        const cachedItems = [card('1', 'Frieren')];
        const { search } = await setup(
            {
                'search.titles': async ({ query }) => {
                    queries.push(query);
                    return { items: [] };
                },
            },
            { query: 'frieren', type: 'anime', items: cachedItems },
        );

        await vi.waitFor(() => expect(search.status.value).toBe('data'));
        expect(search.query.value).toBe('frieren');
        expect(search.items.value).toEqual(cachedItems);

        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 3);
        expect(queries).toEqual([]); // network catches up only on input/retry

        // Retry after a cache restore re-runs the cached query.
        search.retry();
        await vi.waitFor(() => expect(queries).toEqual(['frieren']));
    });

    // Ф5: the search page opens with ?q=… already filled in, so the query comes
    // from outside the input field and must not wait for the typing debounce.
    describe('startQuery (search page, ф.5)', () => {
        it('dispatches immediately, without the 300 ms debounce', async () => {
            const queries: string[] = [];
            const { search } = await setup({
                'search.titles': async ({ query }) => {
                    queries.push(query);
                    return { items: [card('1', 'Frieren')] };
                },
            });

            search.startQuery('frieren');
            // Synchronous part of the dispatch: no timer has been advanced.
            expect(search.query.value).toBe('frieren');
            expect(search.status.value).toBe('loading');

            await vi.advanceTimersByTimeAsync(0); // microtasks only
            expect(queries).toEqual(['frieren']);
            await vi.waitFor(() => expect(search.status.value).toBe('data'));
            expect(search.items.value).toEqual([card('1', 'Frieren')]);
        });

        it('unlike setQuery, which still waits for the debounce', async () => {
            const queries: string[] = [];
            const { search } = await setup({
                'search.titles': async ({ query }) => {
                    queries.push(query);
                    return { items: [] };
                },
            });

            search.setQuery('frieren');
            await vi.advanceTimersByTimeAsync(0);
            expect(queries).toEqual([]); // same wait, nothing dispatched yet
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
            expect(queries).toEqual(['frieren']);
        });

        it('cancels a pending debounced input instead of running both queries', async () => {
            const queries: string[] = [];
            const { search } = await setup({
                'search.titles': async ({ query }) => {
                    queries.push(query);
                    return { items: [] };
                },
            });

            search.setQuery('typed');
            search.startQuery('from menu');
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 3);

            expect(queries).toEqual(['from menu']);
            expect(search.query.value).toBe('from menu');
        });

        it('stays idle without a request for a query shorter than 2 characters', async () => {
            const queries: string[] = [];
            const { search } = await setup({
                'search.titles': async ({ query }) => {
                    queries.push(query);
                    return { items: [] };
                },
            });

            search.startQuery('f');
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 3);
            expect(search.status.value).toBe('idle');
            expect(search.query.value).toBe('f'); // shown in the field, just not searched

            search.startQuery('  x  '); // trimmed length 1
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 3);

            expect(queries).toEqual([]);
            expect(search.status.value).toBe('idle');
            expect(search.items.value).toEqual([]);
        });

        it('is not overwritten by a late session-cache restore', async () => {
            // The restore resolves asynchronously; the ?q= query is already on
            // screen by then, so the previous session's search must be ignored.
            const gate = deferred<Record<string, unknown>>();
            const sessionGet = fakeBrowser.storage.session.get;
            fakeBrowser.storage.session.get = (() => gate.promise) as typeof sessionGet;
            try {
                const { search } = await setup({
                    'search.titles': async () => ({ items: [card('2', 'Berserk')] }),
                });

                search.startQuery('berserk');
                await vi.waitFor(() => expect(search.status.value).toBe('data'));

                gate.resolve({
                    lastSearch: {
                        query: 'frieren',
                        type: 'manga',
                        items: [mangaCard('1', 'Frieren')],
                    },
                });
                await vi.advanceTimersByTimeAsync(0);

                expect(search.query.value).toBe('berserk');
                expect(search.searchType.value).toBe('anime');
                expect(search.items.value).toEqual([card('2', 'Berserk')]);
                expect(search.status.value).toBe('data');
            } finally {
                fakeBrowser.storage.session.get = sessionGet;
            }
        });

        it('drops the response of a superseded startQuery', async () => {
            const first = deferred<{ items: TitleCard[] }>();
            let call = 0;
            const { search } = await setup({
                'search.titles': async () => {
                    call += 1;
                    return call === 1 ? first.promise : { items: [card('2', 'Two')] };
                },
            });

            search.startQuery('one'); // hangs
            search.startQuery('two');
            await vi.waitFor(() => expect(search.items.value).toEqual([card('2', 'Two')]));

            first.resolve({ items: [card('1', 'One')] }); // stale, must be dropped
            await vi.advanceTimersByTimeAsync(0);
            expect(search.items.value).toEqual([card('2', 'Two')]);
            expect(search.status.value).toBe('data');
        });

        it('drops the in-flight response when the query is cleared right after', async () => {
            const pending = deferred<{ items: TitleCard[] }>();
            const { search } = await setup({
                'search.titles': async () => pending.promise,
            });

            search.startQuery('frieren');
            expect(search.status.value).toBe('loading');
            search.startQuery('');
            expect(search.status.value).toBe('idle');

            pending.resolve({ items: [card('1', 'Frieren')] });
            await vi.advanceTimersByTimeAsync(0);
            expect(search.status.value).toBe('idle');
            expect(search.items.value).toEqual([]);
        });
    });

    describe('type switching (US-7)', () => {
        it('setType drops the old results synchronously and re-dispatches with the new type', async () => {
            const requests: { query: string; type: string }[] = [];
            const { search } = await setup({
                'search.titles': async ({ query, type }) => {
                    requests.push({ query, type });
                    return type === 'anime'
                        ? { items: [card('1', 'Anime hit')] }
                        : { items: [mangaCard('7', 'Manga hit')] };
                },
            });

            search.setQuery('frieren');
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
            await vi.waitFor(() => expect(search.status.value).toBe('data'));

            search.setType('manga');
            // The reset is synchronous: no stale anime cards under the new selector.
            expect(search.items.value).toEqual([]);
            expect(search.status.value).toBe('loading');

            // No debounce: the request goes out without advancing the timers.
            await vi.waitFor(() =>
                expect(search.items.value).toEqual([mangaCard('7', 'Manga hit')]),
            );
            expect(search.status.value).toBe('data');
            expect(requests).toEqual([
                { query: 'frieren', type: 'anime' },
                { query: 'frieren', type: 'manga' },
            ]);
        });

        it('setType below the minimum query length resets to idle without a request', async () => {
            const requests: string[] = [];
            const { search } = await setup({
                'search.titles': async ({ type }) => {
                    requests.push(type);
                    return { items: [] };
                },
            });

            search.setQuery('f'); // too short — idle
            search.setType('ranobe');
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 3);

            expect(search.searchType.value).toBe('ranobe');
            expect(search.status.value).toBe('idle');
            expect(search.items.value).toEqual([]);
            expect(requests).toEqual([]);
        });

        it('setType to the current type is a no-op that keeps the results', async () => {
            const requests: string[] = [];
            const { search } = await setup({
                'search.titles': async ({ type }) => {
                    requests.push(type);
                    return { items: [card('1', 'Frieren')] };
                },
            });

            search.setQuery('frieren');
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
            await vi.waitFor(() => expect(search.status.value).toBe('data'));

            search.setType('anime'); // already selected
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);
            expect(search.items.value).toEqual([card('1', 'Frieren')]);
            expect(requests).toEqual(['anime']); // no extra dispatch
        });

        it('drops a stale in-flight response of the previous type after setType', async () => {
            const animeResponse = deferred<{ items: TitleCard[] }>();
            const { search } = await setup({
                'search.titles': async ({ type }) =>
                    type === 'anime'
                        ? animeResponse.promise
                        : { items: [mangaCard('7', 'Berserk')] },
            });

            search.setQuery('berserk');
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS); // the anime request hangs

            search.setType('manga');
            await vi.waitFor(() =>
                expect(search.items.value).toEqual([mangaCard('7', 'Berserk')]),
            );

            animeResponse.resolve({ items: [card('1', 'Berserk (anime)')] }); // stale
            await vi.advanceTimersByTimeAsync(0);
            expect(search.items.value).toEqual([mangaCard('7', 'Berserk')]);
            expect(search.status.value).toBe('data');
        });

        it('restores the search type from the session cache and retries with it', async () => {
            const requests: { query: string; type: string }[] = [];
            const cachedItems = [mangaCard('9', 'Overlord')];
            const { search } = await setup(
                {
                    'search.titles': async ({ query, type }) => {
                        requests.push({ query, type });
                        return { items: cachedItems };
                    },
                },
                { query: 'overlord', type: 'ranobe', items: cachedItems },
            );

            await vi.waitFor(() => expect(search.status.value).toBe('data'));
            expect(search.searchType.value).toBe('ranobe');
            expect(search.items.value).toEqual(cachedItems);
            expect(requests).toEqual([]); // restore alone hits no network

            search.retry(); // the cached type drives the re-run
            await vi.waitFor(() =>
                expect(requests).toEqual([{ query: 'overlord', type: 'ranobe' }]),
            );
        });

        // Ф6-20: `defaultSearchType` decides the start type, but only when
        // nothing fresher exists — the previous session's cache and anything
        // the user already did both outrank it.
        it('starts on the search type from the settings when nothing is cached', async () => {
            const requests: { query: string; type: string }[] = [];
            const { search } = await setup(
                {
                    'search.titles': async ({ query, type }) => {
                        requests.push({ query, type });
                        return { items: [] };
                    },
                },
                undefined,
                { defaultSearchType: 'ranobe' },
            );

            await vi.waitFor(() => expect(search.searchType.value).toBe('ranobe'));
            search.setQuery('overlord');
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
            await vi.waitFor(() =>
                expect(requests).toEqual([{ query: 'overlord', type: 'ranobe' }]),
            );
        });

        it('keeps anime as the start type on a profile without settings', async () => {
            const { search } = await setup();

            await vi.advanceTimersByTimeAsync(0);
            expect(search.searchType.value).toBe('anime');
        });

        it('lets the session cache outrank the settings default', async () => {
            const cachedItems = [mangaCard('9', 'Berserk')];
            const { search } = await setup(
                {},
                { query: 'berserk', type: 'manga', items: cachedItems },
                { defaultSearchType: 'ranobe' },
            );

            await vi.waitFor(() => expect(search.status.value).toBe('data'));
            expect(search.searchType.value).toBe('manga');
        });

        it('does not let a late settings read overwrite a type chosen by the user', async () => {
            // Both start-state reads land together, so gating the local storage
            // holds the whole restore back until the user has acted.
            const gate = deferred<Record<string, unknown>>();
            const localGet = fakeBrowser.storage.local.get;
            fakeBrowser.storage.local.get = (() => gate.promise) as typeof localGet;
            try {
                const { search } = await setup();
                search.setType('manga'); // the user acts before the read lands

                gate.resolve({ settings: { defaultSearchType: 'ranobe' } });
                await vi.advanceTimersByTimeAsync(0);

                expect(search.searchType.value).toBe('manga');
            } finally {
                fakeBrowser.storage.local.get = localGet;
            }
        });

        it('does not let a late cache restore overwrite a type chosen by the user', async () => {
            // The restore resolves asynchronously; a setType before that flips
            // the touched guard, so the cached type/query/items must be ignored.
            const gate = deferred<Record<string, unknown>>();
            const sessionGet = fakeBrowser.storage.session.get;
            fakeBrowser.storage.session.get = (() => gate.promise) as typeof sessionGet;
            try {
                const { search } = await setup();
                search.setType('manga'); // the user acts before the restore lands

                gate.resolve({
                    lastSearch: {
                        query: 'frieren',
                        type: 'anime',
                        items: [card('1', 'Frieren')],
                    },
                });
                await vi.advanceTimersByTimeAsync(0);

                expect(search.searchType.value).toBe('manga');
                expect(search.query.value).toBe('');
                expect(search.items.value).toEqual([]);
                expect(search.status.value).toBe('idle');
            } finally {
                fakeBrowser.storage.session.get = sessionGet;
            }
        });
    });
});
