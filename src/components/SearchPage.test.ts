import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { fakeBrowser } from 'wxt/testing';
import type { MessageHandlers } from '@/src/lib/messaging';
import { i18n } from '@/src/lib/i18n';
import type { AuthState, SearchType, TitleCard } from '@/src/lib/api/types';
import type { UseSearch } from '@/src/composables/use-search';
import { clickOn, createApp, createFakeElement, find, findAll, textOf } from './fake-renderer';
import type { FakeElement } from './fake-renderer';

// Ф5 search page (US-8): opened by the context menu as search.html?q=…, the
// query arrives as a prop (main.ts parses location) and must produce results
// without any typing. Mounted through the shared fake renderer; every test
// rebuilds the module graph because use-search / use-auth keep module state.
// Vue itself is an externalized dep, so vi.resetModules() does NOT duplicate it
// and the statically imported renderer stays compatible with the fresh SFC.

interface SearchRequest {
    query: string;
    type: SearchType;
}

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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

const authorized: AuthState = {
    status: 'authorized',
    user: { id: 1, nickname: 'tester', avatarUrl: 'https://cdn.test/x160.png' },
};

function handlers(overrides: Partial<MessageHandlers>): MessageHandlers {
    return {
        ping: async () => ({ pong: true }),
        'auth.getState': async () => authorized,
        'auth.login': async () => ({ user: { id: 1, nickname: 'tester', avatarUrl: '' } }),
        'auth.logout': async () => ({}),
        'search.titles': async () => ({ items: [] }),
        'rates.list': async () => ({ items: [], hasMore: false }),
        'rates.create': async () => ({ rate: { id: '100', status: 'planned' } }),
        'rates.update': async () => ({
            rate: { id: '100', status: 'watching', score: 0, episodes: 0, chapters: 0, volumes: 0 },
        }),
        'rates.delete': async () => ({}),
        'rates.increment': async () => ({
            rate: { id: '100', status: 'watching', score: 0, episodes: 0, chapters: 0, volumes: 0 },
        }),
        ...overrides,
    };
}

interface Mounted {
    container: FakeElement;
    // Live state of the SAME module graph the page is mounted from — lets a
    // test wait for a search to settle before the auth gate resolves.
    search: UseSearch;
}

let cleanups: Array<() => void> = [];

async function mountPage(
    initialQuery: string,
    overrides: Partial<MessageHandlers> = {},
): Promise<Mounted> {
    vi.resetModules();
    const messaging = await import('@/src/lib/messaging');
    messaging.onMessage(handlers(overrides));
    const { default: SearchPage } = await import('@/entrypoints/search/SearchPage.vue');

    const container = createFakeElement('#container');
    const app = createApp(SearchPage, { initialQuery });
    app.mount(container);
    cleanups.push(() => app.unmount());

    // Imported after the mount so the page owns the composable's init.
    const { useSearch } = await import('@/src/composables/use-search');
    return { container, search: useSearch() };
}

// Drains the microtask queue: messaging and the auth watcher chain resolve
// through promises only (no timers), so a few ticks settle every follow-up.
async function settle(): Promise<void> {
    for (let i = 0; i < 10; i += 1) {
        await nextTick();
    }
}

describe('SearchPage (ф.5)', () => {
    beforeEach(() => {
        fakeBrowser.reset();
        // No DOM here; only the listener surface some children touch on unmount.
        vi.stubGlobal('document', {
            addEventListener: () => {},
            removeEventListener: () => {},
        });
    });

    afterEach(() => {
        for (const cleanup of cleanups) {
            cleanup();
        }
        cleanups = [];
        vi.unstubAllGlobals();
    });

    it('runs the ?q= query once as an anime search and renders the cards', async () => {
        const requests: SearchRequest[] = [];
        const { container } = await mountPage('berserk', {
            'search.titles': async ({ query, type }) => {
                requests.push({ query, type });
                return { items: [card('9', 'Berserk'), card('10', 'Vagabond')] };
            },
        });

        // Dispatched during mount, without the typing debounce: no timer has
        // been advanced and no waiting happened yet.
        expect(requests).toEqual([{ query: 'berserk', type: 'anime' }]);

        await vi.waitFor(() => expect(findAll(container, 'card')).toHaveLength(2));
        expect(findAll(container, 'card').map((el) => textOf(el))).toEqual([
            expect.stringContaining('Berserk'),
            expect.stringContaining('Vagabond'),
        ]);
        // The field shows the handed-over query, and it went out exactly once.
        expect(find(container, 'search__input').props.value).toBe('berserk');
        await settle();
        expect(requests).toEqual([{ query: 'berserk', type: 'anime' }]);
    });

    it('opened without ?q= searches nothing and puts the caret in the field', async () => {
        const requests: SearchRequest[] = [];
        const { container } = await mountPage('', {
            'search.titles': async ({ query, type }) => {
                requests.push({ query, type });
                return { items: [] };
            },
        });

        // The field appears only after the auth gate resolves, so the focus
        // waits for the SearchTab instance.
        await vi.waitFor(() => expect(find(container, 'search__input').focused).toBe(true));
        expect(textOf(find(container, 'empty__text'))).toBe(i18n.search.emptyHint);
        await settle();
        expect(requests).toEqual([]);
    });

    it('replays the query once when the first run failed before login completed', async () => {
        const authGate = deferred<AuthState>();
        const requests: SearchRequest[] = [];
        const { container } = await mountPage('berserk', {
            'auth.getState': () => authGate.promise,
            'search.titles': async ({ query, type }) => {
                requests.push({ query, type });
                if (requests.length === 1) {
                    throw { kind: 'unauthorized' };
                }
                return { items: [card('9', 'Berserk')] };
            },
        });

        // Fired synchronously at mount, while auth is still unknown, and failed.
        await vi.waitFor(() => expect(requests).toHaveLength(1));

        authGate.resolve(authorized);
        await vi.waitFor(() => expect(findAll(container, 'card')).toHaveLength(1));
        await settle();
        expect(requests).toEqual([
            { query: 'berserk', type: 'anime' },
            { query: 'berserk', type: 'anime' },
        ]);
    });

    // A run that left while signed out carries no token whatever its current
    // state, so the replay must not wait for it to fail: the user signs in
    // through LoginScreen while the first run still hangs, and the page has to
    // come back with results rather than an error screen.
    it('replays a query still in flight when the user signs in', async () => {
        const searchGate = deferred<void>();
        const requests: SearchRequest[] = [];
        const { container } = await mountPage('berserk', {
            'auth.getState': async () => ({ status: 'anonymous' }),
            'auth.login': async () => ({
                user: { id: 1, nickname: 'tester', avatarUrl: 'https://cdn.test/x160.png' },
            }),
            'search.titles': async ({ query, type }) => {
                requests.push({ query, type });
                if (requests.length === 1) {
                    await searchGate.promise; // hangs across the whole login
                    throw { kind: 'unauthorized' };
                }
                return { items: [card('9', 'Berserk')] };
            },
        });

        await vi.waitFor(() => expect(requests).toHaveLength(1));
        clickOn(find(container, 'login__button'));
        await vi.waitFor(() => expect(requests).toHaveLength(2));

        searchGate.resolve(undefined); // the signed-out run 401s only now
        await settle();
        await vi.waitFor(() => expect(findAll(container, 'card')).toHaveLength(1));
        // The late 401 belongs to a superseded request id and is dropped.
        expect(requests).toHaveLength(2);
    });

    it('does not replay a query that already succeeded before login completed', async () => {
        const authGate = deferred<AuthState>();
        const requests: SearchRequest[] = [];
        const { container, search } = await mountPage('berserk', {
            'auth.getState': () => authGate.promise,
            'search.titles': async ({ query, type }) => {
                requests.push({ query, type });
                return { items: [card('9', 'Berserk')] };
            },
        });

        // The run must be finished (status 'data') before auth flips, otherwise
        // the watcher would have nothing to judge.
        await vi.waitFor(() => expect(search.status.value).toBe('data'));

        authGate.resolve(authorized);
        await vi.waitFor(() => expect(findAll(container, 'card')).toHaveLength(1));
        await settle();
        expect(requests).toHaveLength(1);
    });

    it('shows the login screen without the header for an anonymous user', async () => {
        const requests: SearchRequest[] = [];
        const { container } = await mountPage('berserk', {
            'auth.getState': async () => ({ status: 'anonymous' }),
            'search.titles': async ({ query, type }) => {
                requests.push({ query, type });
                return { items: [card('9', 'Berserk')] };
            },
        });

        await vi.waitFor(() => expect(findAll(container, 'login')).toHaveLength(1));
        expect(textOf(find(container, 'login__lead'))).toBe(i18n.login.lead);
        expect(findAll(container, 'header')).toHaveLength(0);
        expect(findAll(container, 'search__input')).toHaveLength(0);
        expect(findAll(container, 'card')).toHaveLength(0);
    });

    it('renders the error state and re-runs the query from its retry button', async () => {
        const requests: SearchRequest[] = [];
        const { container } = await mountPage('berserk', {
            'search.titles': async ({ query, type }) => {
                requests.push({ query, type });
                throw { kind: 'network' };
            },
        });

        await vi.waitFor(() => expect(findAll(container, 'error')).toHaveLength(1));
        expect(textOf(find(container, 'error__text'))).toBe(i18n.errors.network);
        expect(textOf(find(container, 'error__retry')).trim()).toBe(i18n.actions.retry);

        await settle(); // let the post-login replay (if any) finish first
        const before = requests.length;
        clickOn(find(container, 'error__retry'));
        await vi.waitFor(() => expect(requests).toHaveLength(before + 1));
        expect(requests[before]).toEqual({ query: 'berserk', type: 'anime' });
        // The retry swaps the error for a skeleton and, failing the same way,
        // lands back on the error state.
        expect(findAll(container, 'skeleton')).toHaveLength(1);
        await vi.waitFor(() => expect(findAll(container, 'error')).toHaveLength(1));
    });
});
