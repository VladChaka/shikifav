import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { fakeBrowser } from 'wxt/testing';
import type { MessageHandlers } from '@/src/lib/messaging';
import type { SearchType, TitleCard } from '@/src/lib/api/types';
import { clickOn, createApp, createFakeElement, find, findAll, textOf } from './fake-renderer';
import type { FakeElement } from './fake-renderer';

// Ф5-11 (owner decision): the context menu opens the POPUP instead of a tab and
// hands the selection over through the one-shot session key `pendingSearch`.
// This file owns the receiving half — the popup App. Every case rebuilds the
// module graph (use-search / use-auth keep module state) and seeds storage
// before mounting, exactly as background does before calling openPopup().

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

function handlers(overrides: Partial<MessageHandlers>): MessageHandlers {
    return {
        ping: async () => ({ pong: true }),
        'auth.getState': async () => ({
            status: 'authorized',
            user: { id: 1, nickname: 'tester', avatarUrl: 'https://cdn.test/x160.png' },
        }),
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
        'settings.setOrigin': async () => ({}),
        ...overrides,
    };
}

let cleanups: Array<() => void> = [];

// Seeds run against the SAME fresh module graph the popup is mounted from, so
// the storage wrapper the test writes through is the one App.vue reads.
async function mountPopup(
    seed: (storage: typeof import('@/src/lib/storage')) => Promise<void>,
    overrides: Partial<MessageHandlers> = {},
): Promise<FakeElement> {
    vi.resetModules();
    const messaging = await import('@/src/lib/messaging');
    messaging.onMessage(handlers(overrides));
    const storage = await import('@/src/lib/storage');
    await seed(storage);
    const { default: App } = await import('@/entrypoints/popup/App.vue');

    const container = createFakeElement('#container');
    const app = createApp(App);
    app.mount(container);
    cleanups.push(() => app.unmount());
    return container;
}

// Drains the microtask queue: the onMounted storage reads and the follow-up
// search resolve through promises only, no timers.
async function settle(): Promise<void> {
    for (let i = 0; i < 10; i += 1) {
        await nextTick();
    }
}

function activeTabLabel(container: FakeElement): string {
    return textOf(find(container, 'tabs__tab--active'));
}

describe('popup opened by the context menu (pendingSearch, ф.5)', () => {
    beforeEach(() => {
        fakeBrowser.reset();
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

    it('runs the handed-over query once and shows it on the search tab', async () => {
        const requests: SearchRequest[] = [];
        const container = await mountPopup(
            async ({ setSession }) => {
                // The tab the user left the popup on must lose to the query.
                await setSession('lastTab', 'lists');
                await setSession('pendingSearch', { query: 'берсерк' });
            },
            {
                'search.titles': async ({ query, type }) => {
                    requests.push({ query, type });
                    return { items: [card('9', 'Berserk')] };
                },
            },
        );

        await vi.waitFor(() => expect(findAll(container, 'card')).toHaveLength(1));
        expect(requests).toEqual([{ query: 'берсерк', type: 'anime' }]);
        expect(activeTabLabel(container)).toContain('Поиск');
        expect(find(container, 'search__input').props.value).toBe('берсерк');

        await settle();
        // No second dispatch once everything settles.
        expect(requests).toHaveLength(1);
    });

    it('drops the key so a later manual open does not replay the search', async () => {
        const container = await mountPopup(async ({ setSession }) => {
            await setSession('pendingSearch', { query: 'берсерк' });
        });

        await settle();
        const { getSession } = await import('@/src/lib/storage');
        expect(await getSession('pendingSearch')).toBeUndefined();
        expect(findAll(container, 'card')).toHaveLength(0);
    });

    it('searches anime even when the session cache holds another type', async () => {
        const requests: SearchRequest[] = [];
        await mountPopup(
            async ({ setSession }) => {
                // A ranobe search from the previous popup session: restoring it
                // would silently answer an anime title with zero results.
                await setSession('lastSearch', { query: 'kimetsu', type: 'ranobe', items: [] });
                await setSession('pendingSearch', { query: 'берсерк' });
            },
            {
                'search.titles': async ({ query, type }) => {
                    requests.push({ query, type });
                    return { items: [card('9', 'Berserk')] };
                },
            },
        );

        await vi.waitFor(() => expect(requests).toHaveLength(1));
        await settle();
        expect(requests).toEqual([{ query: 'берсерк', type: 'anime' }]);
    });

    // Ф6-20 (owner decision): the type used to be pinned to 'anime' here,
    // because a selection carries none and a cached «Ранобэ» would silently
    // answer with zero results. The user now has an explicit default type, and
    // it outranks that rule — while the cache still loses to it.
    it('searches with the default type from the settings', async () => {
        const requests: SearchRequest[] = [];
        await mountPopup(
            async ({ setSession, setSettings }) => {
                await setSettings({ defaultSearchType: 'ranobe' });
                await setSession('lastSearch', { query: 'kimetsu', type: 'manga', items: [] });
                await setSession('pendingSearch', { query: 'берсерк' });
            },
            {
                'search.titles': async ({ query, type }) => {
                    requests.push({ query, type });
                    return { items: [card('9', 'Berserk')] };
                },
            },
        );

        await vi.waitFor(() => expect(requests).toHaveLength(1));
        await settle();
        expect(requests).toEqual([{ query: 'берсерк', type: 'ranobe' }]);
    });

    // Signing in opens the OAuth window and Chrome closes the popup with it, so
    // a key consumed on read would lose the query for good: the user would have
    // to go back and select the text again.
    it('keeps the key while the user is signed out', async () => {
        const container = await mountPopup(
            async ({ setSession }) => {
                await setSession('pendingSearch', { query: 'берсерк' });
            },
            {
                'auth.getState': async () => ({ status: 'anonymous' }),
                'search.titles': async () => {
                    throw { kind: 'unauthorized' };
                },
            },
        );

        await vi.waitFor(() => expect(findAll(container, 'login')).toHaveLength(1));
        await settle();
        const { getSession } = await import('@/src/lib/storage');
        expect(await getSession('pendingSearch')).toEqual({ query: 'берсерк' });
    });

    it('replays the query and drops the key once the user signs in', async () => {
        const requests: SearchRequest[] = [];
        const container = await mountPopup(
            async ({ setSession }) => {
                await setSession('pendingSearch', { query: 'берсерк' });
            },
            {
                'auth.getState': async () => ({ status: 'anonymous' }),
                'auth.login': async () => ({
                    user: { id: 1, nickname: 'tester', avatarUrl: 'https://cdn.test/x160.png' },
                }),
                'search.titles': async ({ query, type }) => {
                    requests.push({ query, type });
                    if (requests.length === 1) {
                        throw { kind: 'unauthorized' };
                    }
                    return { items: [card('9', 'Berserk')] };
                },
            },
        );

        await vi.waitFor(() => expect(findAll(container, 'login')).toHaveLength(1));
        clickOn(find(container, 'login__button'));

        await vi.waitFor(() => expect(findAll(container, 'card')).toHaveLength(1));
        expect(requests).toEqual([
            { query: 'берсерк', type: 'anime' },
            { query: 'берсерк', type: 'anime' },
        ]);
        const { getSession } = await import('@/src/lib/storage');
        expect(await getSession('pendingSearch')).toBeUndefined();
    });

    it('without the key restores the last tab and searches nothing', async () => {
        const requests: SearchRequest[] = [];
        const container = await mountPopup(
            async ({ setSession }) => {
                await setSession('lastTab', 'lists');
            },
            {
                'search.titles': async ({ query, type }) => {
                    requests.push({ query, type });
                    return { items: [] };
                },
            },
        );

        await vi.waitFor(() => expect(activeTabLabel(container)).toContain('Мои списки'));
        await settle();
        expect(requests).toEqual([]);
    });
});
