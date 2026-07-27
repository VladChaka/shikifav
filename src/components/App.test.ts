import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { fakeBrowser } from 'wxt/testing';
import App from '@/entrypoints/popup/App.vue';
import { onMessage } from '@/src/lib/messaging';
import type { MessageHandlers } from '@/src/lib/messaging';
import { setSession } from '@/src/lib/storage';
import { i18n } from '@/src/lib/i18n';
import type { ApiError, TitleCard, UserRateRef } from '@/src/lib/api/types';
import { clickOn, createApp, createFakeElement, find, findAll, textOf } from './fake-renderer';
import type { FakeElement } from './fake-renderer';

// Ф4-6b regression: busyIds/warnings of use-rates are keyed by the composite
// rateKey (`${targetType}:${id}`), and the App.vue template must look them up
// with the SAME key shape. Both sides are plain strings, so a mismatch (e.g. a
// template reverted to card.id) compiles fine and silently disables the busy
// lock and the inline warning — only a mounted App catches it. The full App is
// mounted through the shared fake renderer; network goes through the standard
// messaging stubs (no real fetch).

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
        'auth.getState': async () => ({
            status: 'authorized',
            user: { id: 1, nickname: 'tester', avatarUrl: 'https://cdn.test/x160.png' },
        }),
        'auth.login': async () => ({
            user: { id: 1, nickname: 'tester', avatarUrl: '' },
        }),
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

let cleanups: Array<() => void> = [];

function mountApp(): FakeElement {
    const container = createFakeElement('#container');
    const app = createApp(App);
    app.mount(container);
    cleanups.push(() => app.unmount());
    return container;
}

// The TitleCard of a given title, re-queried after every await: in-place item
// patches re-render the card subtree.
function cardByTitle(container: FakeElement, title: string): FakeElement {
    const card = findAll(container, 'card').find((el) => textOf(el).includes(title));
    if (!card) {
        throw new Error(`card "${title}" not found`);
    }
    return card;
}

// The session cache feeds the instant first render (no debounce, no network):
// two userRate-less manga cards whose ids collide with nothing anime-side.
function seedSearch(): Promise<void> {
    return setSession('lastSearch', {
        query: 'berserk',
        type: 'manga',
        items: [mangaCard('9', 'Berserk'), mangaCard('10', 'Vagabond')],
    });
}

describe('App rate-state wiring (composite rateKey)', () => {
    beforeEach(() => {
        fakeBrowser.reset();
        // No DOM in this environment; XSelect (closed) and unmount hooks only
        // need the listener API surface of document.
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

    it('locks exactly the acted-on card while its write is in flight', async () => {
        const server = deferred<{ rate: UserRateRef }>();
        onMessage(handlers({ 'rates.create': async () => server.promise }));
        await seedSearch();

        const container = mountApp();
        await vi.waitFor(() => expect(findAll(container, 'card')).toHaveLength(2));

        clickOn(find(cardByTitle(container, 'Berserk'), 'card__add'));
        await nextTick();

        // Optimistic create flipped the control to the status badge; the busy
        // lock must reach it through the composite key lookup.
        const badge = find(cardByTitle(container, 'Berserk'), 'card__badge');
        expect(badge.props.disabled).toBe(true);
        // The sibling card is not locked.
        expect(find(cardByTitle(container, 'Vagabond'), 'card__add').props.disabled).toBe(false);

        server.resolve({ rate: { id: '55', status: 'planned' } });
        await vi.waitFor(() =>
            expect(find(cardByTitle(container, 'Berserk'), 'card__badge').props.disabled).toBe(
                false,
            ),
        );
    });

    it('renders the inline edit-forbidden warning on the acted-on card', async () => {
        onMessage(
            handlers({
                'rates.create': async () => {
                    throw { kind: 'unauthorized' } satisfies ApiError;
                },
            }),
        );
        await seedSearch();

        const container = mountApp();
        await vi.waitFor(() => expect(findAll(container, 'card').length).toBeGreaterThan(0));

        clickOn(find(cardByTitle(container, 'Vagabond'), 'card__add'));
        await vi.waitFor(() =>
            expect(findAll(cardByTitle(container, 'Vagabond'), 'card__warning')).toHaveLength(1),
        );
        expect(textOf(find(cardByTitle(container, 'Vagabond'), 'card__warning'))).toBe(
            i18n.errors.editForbidden,
        );
        // Rolled back: the split button is available again, and the policy is
        // inline-only — no toast.
        expect(find(cardByTitle(container, 'Vagabond'), 'card__add').props.disabled).toBe(false);
        expect(findAll(container, 'toast')).toHaveLength(0);
    });
});
