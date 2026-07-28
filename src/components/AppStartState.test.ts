import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { fakeBrowser } from 'wxt/testing';
import type { MessageHandlers } from '@/src/lib/messaging';
import type { RateCreateParams, TitleCard } from '@/src/lib/api/types';
import { clickOn, createApp, createFakeElement, find, findAll, textOf } from './fake-renderer';
import type { FakeElement } from './fake-renderer';

// Ф6-20: the behavioural settings the popup applies at open — `startTab` (which
// tab the popup opens on) and `quickStatus` (what the one-click add button on a
// search card writes, and how it labels itself). Both are read from storage
// asynchronously, so they are only observable on a mounted App: this file owns
// that wiring. Every case rebuilds the module graph (use-search / use-auth /
// use-settings keep module state) and seeds storage before mounting.

function animeCard(id: string, name: string): TitleCard {
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
        'calendar.list': async () => ({ items: [] }),
        'posters.fetch': async () => ({ posters: {} }),
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

// Seeds run against the SAME fresh module graph the popup is mounted from
// (pattern of AppPendingSearch.test.ts).
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

// Drains the microtask queue: the storage reads at open and the follow-up
// renders resolve through promises only, no timers.
async function settle(): Promise<void> {
    for (let i = 0; i < 10; i += 1) {
        await nextTick();
    }
}

function activeTabLabel(container: FakeElement): string {
    return textOf(find(container, 'tabs__tab--active'));
}

function cardByTitle(container: FakeElement, title: string): FakeElement {
    const card = findAll(container, 'card').find((el) => textOf(el).includes(title));
    if (!card) {
        throw new Error(`card "${title}" not found`);
    }
    return card;
}

describe('popup start state from the settings (Ф6-20)', () => {
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
        // fakeBrowser.reset() does not undo a spy, and a storage stub left in
        // place would break every later case in the file.
        vi.restoreAllMocks();
    });

    describe('startTab', () => {
        it('opens «Мои списки» when the setting pins that tab', async () => {
            const listCalls: string[] = [];
            const container = await mountPopup(
                async ({ setSession, setSettings }) => {
                    await setSettings({ startTab: 'lists' });
                    // The cached tab must lose to the pinned one.
                    await setSession('lastTab', 'search');
                },
                {
                    'rates.list': async ({ status }) => {
                        listCalls.push(status);
                        return { items: [], hasMore: false };
                    },
                },
            );

            await vi.waitFor(() => expect(activeTabLabel(container)).toContain('Мои списки'));
            // Showing the tab is what loads it: the pinned tab must arrive with
            // its rows, not empty until the user clicks something.
            await vi.waitFor(() => expect(listCalls).toEqual(['watching']));
        });

        it('opens «Поиск» when the setting pins that tab', async () => {
            const container = await mountPopup(async ({ setSession, setSettings }) => {
                await setSettings({ startTab: 'search' });
                await setSession('lastTab', 'lists');
            });

            await settle();
            expect(activeTabLabel(container)).toContain('Поиск');
        });

        it('restores the cached tab on the default profile', async () => {
            const container = await mountPopup(async ({ setSession }) => {
                await setSession('lastTab', 'lists');
            });

            await vi.waitFor(() => expect(activeTabLabel(container)).toContain('Мои списки'));
        });

        it('keeps writing the cache while the setting pins a tab', async () => {
            // 'last' lives on that cache, so a pinned tab must not stop it from
            // being written — otherwise switching the setting back to 'last'
            // would restore a stale tab.
            const container = await mountPopup(async ({ setSettings }) => {
                await setSettings({ startTab: 'search' });
            });
            await settle();

            const listsTab = findAll(container, 'tabs__tab').find((el) =>
                textOf(el).includes('Мои списки'),
            );
            clickOn(listsTab as FakeElement);

            const { getSession } = await import('@/src/lib/storage');
            await vi.waitFor(async () => expect(await getSession('lastTab')).toBe('lists'));
        });
    });

    // Ф6-23: every read at open (App.vue, use-settings, use-search, use-lists) is
    // fire-and-forget, so a rejected chrome.storage call used to surface as an
    // unhandled rejection instead of a fallback. The popup must still open.
    describe('a failing chrome.storage', () => {
        function breakStorage(): void {
            const fail = (): Promise<never> => Promise.reject(new Error('storage unavailable'));
            vi.spyOn(fakeBrowser.storage.local, 'get').mockImplementation(fail);
            vi.spyOn(fakeBrowser.storage.session, 'get').mockImplementation(fail);
        }

        it('opens the popup on the defaults and keeps it usable', async () => {
            const listCalls: string[] = [];
            const container = await mountPopup(
                async () => {
                    breakStorage();
                },
                {
                    'rates.list': async ({ status }) => {
                        listCalls.push(status);
                        return { items: [], hasMore: false };
                    },
                },
            );

            // The shell is up: auth comes from background, not from storage.
            await vi.waitFor(() => expect(findAll(container, 'header')).toHaveLength(1));
            await settle();
            // Nothing restored and no setting read — the documented default view.
            expect(activeTabLabel(container)).toContain('Поиск');
            expect(findAll(container, 'card')).toHaveLength(0);

            // And it still works: the lists tab loads its default filter.
            const listsTab = findAll(container, 'tabs__tab').find((el) =>
                textOf(el).includes('Мои списки'),
            );
            clickOn(listsTab as FakeElement);

            await vi.waitFor(() => expect(listCalls).toEqual(['watching']));
            await settle();
        });
    });

    describe('quickStatus', () => {
        // The session cache feeds the instant first render (no debounce, no
        // network): one anime and one manga card, both outside my list.
        function seedCards(storage: typeof import('@/src/lib/storage')): Promise<void> {
            return storage.setSession('lastSearch', {
                query: 'berserk',
                type: 'manga',
                items: [animeCard('9', 'Berserk'), mangaCard('10', 'Vagabond')],
            });
        }

        it('labels the button with the configured status, in the media wording', async () => {
            const container = await mountPopup(async (storage) => {
                await storage.setSettings({ quickStatus: 'watching' });
                await seedCards(storage);
            });

            await vi.waitFor(() => expect(findAll(container, 'card')).toHaveLength(2));
            await vi.waitFor(() =>
                expect(textOf(find(cardByTitle(container, 'Berserk'), 'card__add')).trim()).toBe(
                    '+ Смотрю',
                ),
            );
            // Same status, book wording on the manga card.
            expect(textOf(find(cardByTitle(container, 'Vagabond'), 'card__add')).trim()).toBe(
                '+ Читаю',
            );
        });

        it('creates the rate with the configured status', async () => {
            const created: RateCreateParams[] = [];
            const container = await mountPopup(
                async (storage) => {
                    await storage.setSettings({ quickStatus: 'on_hold' });
                    await seedCards(storage);
                },
                {
                    'rates.create': async (params) => {
                        created.push(params);
                        return { rate: { id: '100', status: params.status } };
                    },
                },
            );

            await vi.waitFor(() => expect(findAll(container, 'card')).toHaveLength(2));
            // The label is driven by the same settings ref as the write.
            await vi.waitFor(() =>
                expect(textOf(find(cardByTitle(container, 'Berserk'), 'card__add')).trim()).toBe(
                    '+ Отложено',
                ),
            );
            clickOn(find(cardByTitle(container, 'Berserk'), 'card__add'));

            await vi.waitFor(() =>
                expect(created).toEqual([
                    { targetId: '9', targetType: 'Anime', status: 'on_hold' },
                ]),
            );
        });

        it('adds to «Запланировано» on the default profile', async () => {
            const created: RateCreateParams[] = [];
            const container = await mountPopup(seedCards, {
                'rates.create': async (params) => {
                    created.push(params);
                    return { rate: { id: '100', status: params.status } };
                },
            });

            await vi.waitFor(() => expect(findAll(container, 'card')).toHaveLength(2));
            expect(textOf(find(cardByTitle(container, 'Berserk'), 'card__add')).trim()).toBe(
                '+ Запланировано',
            );
            clickOn(find(cardByTitle(container, 'Berserk'), 'card__add'));

            await vi.waitFor(() =>
                expect(created).toEqual([
                    { targetId: '9', targetType: 'Anime', status: 'planned' },
                ]),
            );
        });
    });
});
