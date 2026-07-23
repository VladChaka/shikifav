import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import type { MessageHandlers } from '../lib/messaging';
import type { SessionState } from '../lib/storage';
import type { ApiError, TitleCard } from '../lib/api/types';
import type { UseSearch } from './use-search';

const DEBOUNCE_MS = 300;

function card(id: string, name: string): TitleCard {
    return {
        id,
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
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
): Promise<Setup> {
    vi.resetModules();
    const messaging = await import('../lib/messaging');
    messaging.onMessage({
        ping: async () => ({ pong: true }),
        'auth.getState': async () => ({ status: 'anonymous' }),
        'auth.login': async () => ({
            user: { id: 1, nickname: 'tester', avatarUrl: '' },
        }),
        'auth.logout': async () => ({}),
        'search.titles': async () => ({ items: [] }),
        'rates.create': async () => ({ rate: { id: '1', status: 'planned' } }),
        'rates.update': async () => ({ rate: { id: '1', status: 'watching' } }),
        'rates.delete': async () => ({}),
        ...overrides,
    });
    const storage = await import('../lib/storage');
    if (seedLastSearch) {
        await storage.setSession('lastSearch', seedLastSearch);
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
});
