import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { fakeBrowser } from 'wxt/testing';
import App from '@/entrypoints/popup/App.vue';
import { onMessage } from '@/src/lib/messaging';
import type { MessageHandlers } from '@/src/lib/messaging';
import { setSession } from '@/src/lib/storage';
import { i18n } from '@/src/lib/i18n';
import type {
    ApiError,
    RateRow,
    RelatedItem,
    RelationKind,
    TitleCard,
    UserRateRef,
} from '@/src/lib/api/types';
import {
    clickOn,
    createApp,
    createFakeElement,
    find,
    findAll,
    fire,
    textOf,
} from './fake-renderer';
import type { FakeElement, FakeNode } from './fake-renderer';

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
        'calendar.list': async () => ({ items: [] }),
        'titles.related': async () => ({ items: [] }),
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
        'analytics.track': async () => ({}),
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

// --- Ф12-8: the «Связанные» overlay -----------------------------------------
// The overlay is the one screen of this popup that is not a tab: it covers the
// tab row and the tab content, keeps them mounted underneath and gives the caret
// back to the control it was opened from. That wiring exists only on a mounted
// App — the three entry points, the overlay and the composable are four separate
// files, and every seam between them is a place where a click reaches nothing.
//
// Every case mounts the popup on a FRESH module graph (use-related keeps
// module-level state, its in-memory cache included), pattern of
// AppStartState.test.ts.

function animeCard(id: string, name: string, overrides: Partial<TitleCard> = {}): TitleCard {
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
        // Non-null on purpose: a seeded search card must not spend a poster
        // request, so every posters.fetch a case sees belongs to the overlay.
        posterUrl: 'https://desu.shikimori.one/uploads/poster/animes/x/mini.webp',
        posterUrl2x: null,
        userRate: null,
        url: `https://shikimori.io/animes/${id}`,
        ...overrides,
    };
}

function relatedItem(kind: RelationKind, card: TitleCard, text = 'Связь'): RelatedItem {
    return { relationKind: kind, relationText: text, card };
}

function listRow(overrides: Partial<RateRow> = {}): RateRow {
    return {
        rateId: '311',
        targetId: '52991',
        targetType: 'Anime',
        name: 'Sousou no Frieren',
        russian: null,
        posterUrl: 'https://desu.shikimori.one/uploads/poster/animes/52991/mini.webp',
        posterUrl2x: null,
        status: 'watching',
        score: 8,
        progress: 27,
        total: 28,
        ...overrides,
    };
}

// document.activeElement is the only thing the overlay reads to know where to
// send the caret back (App.focusableActiveElement), and this environment has no
// DOM at all.
interface FakeDocument {
    activeElement: unknown;
}

interface OverlayPopup {
    container: FakeElement;
    doc: FakeDocument;
    // Payloads of titles.related, in order — the request counter of the DoD.
    asked: Array<{ targetId: string; targetType: string }>;
    posters: Array<{ type: string; ids: string[] }>;
}

interface OverlayOptions {
    cards?: TitleCard[];
    related?: RelatedItem[];
    rows?: RateRow[];
    // REST poster answers per bucket: type -> id -> url.
    posters?: Partial<Record<string, Record<string, string>>>;
    // Held poster answers: `posters.fetch` waits on this before replying, so a
    // case can put the user in front of the finished rows BEFORE the pictures
    // land — the backfill is what replaces the row array under their hands.
    holdPosters?: Promise<void>;
}

async function settle(): Promise<void> {
    for (let i = 0; i < 10; i += 1) {
        await nextTick();
    }
}

async function mountOverlayPopup(options: OverlayOptions = {}): Promise<OverlayPopup> {
    const asked: Array<{ targetId: string; targetType: string }> = [];
    const posterCalls: Array<{ type: string; ids: string[] }> = [];

    vi.resetModules();
    const messaging = await import('@/src/lib/messaging');
    messaging.onMessage(
        handlers({
            'titles.related': async ({ targetId, targetType }) => {
                asked.push({ targetId, targetType });
                return { items: options.related ?? [] };
            },
            'posters.fetch': async ({ type, ids }) => {
                posterCalls.push({ type, ids });
                await options.holdPosters;
                return { posters: options.posters?.[type] ?? {} };
            },
            'rates.list': async () => ({ items: options.rows ?? [], hasMore: false }),
        }),
    );
    const storage = await import('@/src/lib/storage');
    if (options.cards) {
        await storage.setSession('lastSearch', {
            query: 'berserk',
            type: 'anime',
            items: options.cards,
        });
    }
    const { default: PopupApp } = await import('@/entrypoints/popup/App.vue');

    const doc: FakeDocument = { activeElement: null };
    vi.stubGlobal('document', {
        ...doc,
        get activeElement(): unknown {
            return doc.activeElement;
        },
        addEventListener: () => {},
        removeEventListener: () => {},
    });

    const container = createFakeElement('#container');
    const app = createApp(PopupApp);
    app.mount(container);
    cleanups.push(() => app.unmount());
    await settle();
    return { container, doc, asked, posters: posterCalls };
}

// A real pointer click focuses what it hits, and el.focus() moves
// document.activeElement — the fake renderer records neither. The two are wired
// together here for the elements a case actually clicks, because that is exactly
// what the focus-return rule of the overlay reads.
function focusable(doc: FakeDocument, el: FakeElement): FakeElement {
    el.focus = (): void => {
        el.focused = true;
        doc.activeElement = el;
    };
    return el;
}

// `stop` for the triggers that carry @click.stop (the status-menu ones).
function clickFocusing(doc: FakeDocument, el: FakeElement, stop = false): void {
    focusable(doc, el).focus();
    fire(el, 'click', stop ? { target: el, stopPropagation: () => {} } : { target: el });
}

function squash(node: FakeElement): string {
    return textOf(node).replace(/\s+/g, ' ').trim();
}

// Every element the renderer would hand an `inert` attribute to — the frozen
// part of the tree, found by what is bound rather than by what it is called.
// `undefined` is the value that drops the attribute, so it does not count.
function inertElements(root: FakeNode): FakeElement[] {
    const found: FakeElement[] = [];
    const visit = (node: FakeNode): void => {
        if (node.kind === 'element' && node.props.inert !== undefined) {
            found.push(node as FakeElement);
        }
        for (const child of node.children) {
            visit(child);
        }
    };
    visit(root);
    return found;
}

function relatedRow(container: FakeElement, title: string): FakeElement {
    const row = findAll(container, 'related-row').find((el) => textOf(el).includes(title));
    if (!row) {
        throw new Error(`related row "${title}" not found`);
    }
    return row;
}

describe('App «Связанные» overlay (Ф12-8)', () => {
    beforeEach(() => {
        fakeBrowser.reset();
    });

    afterEach(() => {
        for (const cleanup of cleanups) {
            cleanup();
        }
        cleanups = [];
        vi.unstubAllGlobals();
    });

    it('covers the tabs from the search card without unmounting them', async () => {
        const popup = await mountOverlayPopup({
            cards: [animeCard('9', 'Berserk'), animeCard('10', 'Vagabond')],
            related: [relatedItem('sequel', animeCard('11', 'Berserk 1997'))],
        });
        await vi.waitFor(() => expect(findAll(popup.container, 'card')).toHaveLength(2));
        const cardsBefore = findAll(popup.container, 'card');
        const tabsBefore = find(popup.container, 'tabs');

        clickFocusing(popup.doc, find(cardByTitle(popup.container, 'Berserk'), 'card__related'));
        await vi.waitFor(() => expect(findAll(popup.container, 'related')).toHaveLength(1));

        // The return bar names the title the links belong to.
        expect(squash(find(popup.container, 'related__target'))).toBe('Berserk');
        expect(popup.asked).toEqual([{ targetId: '9', targetType: 'Anime' }]);

        // The tab underneath is covered, never replaced: same elements, same
        // instances — a remount would lose its scroll position and its state.
        const cardsAfter = findAll(popup.container, 'card');
        expect(cardsAfter).toHaveLength(2);
        expect(cardsAfter[0]).toBe(cardsBefore[0]);
        expect(cardsAfter[1]).toBe(cardsBefore[1]);
        expect(find(popup.container, 'tabs')).toBe(tabsBefore);
        expect(findAll(popup.container, 'lists')).toHaveLength(1);
        expect(findAll(popup.container, 'calendar')).toHaveLength(1);

        // ⚙ and «Выйти» stay reachable: the overlay fills the box below the
        // header, and the header is not in it.
        const body = find(popup.container, 'app__body');
        expect(find(popup.container, 'related').parent).toBe(body);
        expect(findAll(body, 'header')).toHaveLength(0);
        expect(findAll(popup.container, 'header')).toHaveLength(1);
    });

    it('goes back to the same place and hands the caret to the control it left from', async () => {
        const popup = await mountOverlayPopup({
            cards: [animeCard('9', 'Berserk'), animeCard('10', 'Vagabond')],
            related: [relatedItem('sequel', animeCard('11', 'Berserk 1997'))],
        });
        await vi.waitFor(() => expect(findAll(popup.container, 'card')).toHaveLength(2));

        const control = find(cardByTitle(popup.container, 'Berserk'), 'card__related');
        clickFocusing(popup.doc, control);
        await vi.waitFor(() => expect(findAll(popup.container, 'related-row')).toHaveLength(1));

        // Only the return may set this again.
        control.focused = false;
        popup.doc.activeElement = null;

        clickOn(find(popup.container, 'related__back'));
        await settle();

        expect(findAll(popup.container, 'related')).toHaveLength(0);
        expect(control.focused).toBe(true);
        expect(popup.doc.activeElement).toBe(control);
        // The search results are exactly where they were.
        expect(findAll(popup.container, 'card')).toHaveLength(2);
    });

    it('opens from a list row with the title id, not the rate id', async () => {
        const popup = await mountOverlayPopup({
            rows: [listRow()],
            related: [relatedItem('prequel', animeCard('11', 'Frieren prequel'))],
        });
        clickOn(findAll(popup.container, 'tabs__tab')[1]!);
        await vi.waitFor(() => expect(findAll(popup.container, 'rate')).toHaveLength(1));

        clickFocusing(popup.doc, find(popup.container, 'rate__related'));
        await vi.waitFor(() => expect(findAll(popup.container, 'related')).toHaveLength(1));

        expect(popup.asked).toEqual([{ targetId: '52991', targetType: 'Anime' }]);
        expect(squash(find(popup.container, 'related__target'))).toBe('Sousou no Frieren');
        // «Мои списки» keeps its row under the overlay.
        expect(findAll(popup.container, 'rate')).toHaveLength(1);
    });

    it('opens from the status menu of a card and gives the caret to its trigger', async () => {
        const popup = await mountOverlayPopup({
            cards: [animeCard('9', 'Berserk')],
            related: [relatedItem('sequel', animeCard('11', 'Berserk 1997'))],
        });
        await vi.waitFor(() => expect(findAll(popup.container, 'card')).toHaveLength(1));

        const caret = find(popup.container, 'card__caret');
        clickFocusing(popup.doc, caret, true);
        await nextTick();

        const navItem = find(popup.container, 'menu__item--nav');
        expect(squash(navItem)).toContain(i18n.related.open);

        // The item is about to unmount with the menu, so the trigger must take
        // the caret before the overlay reads document.activeElement.
        caret.focused = false;
        popup.doc.activeElement = navItem;
        clickOn(navItem);
        await vi.waitFor(() => expect(findAll(popup.container, 'related')).toHaveLength(1));

        expect(popup.asked).toEqual([{ targetId: '9', targetType: 'Anime' }]);
        expect(findAll(popup.container, 'menu')).toHaveLength(0);
        expect(caret.focused).toBe(true);
        expect(popup.doc.activeElement).toBe(caret);

        caret.focused = false;
        clickOn(find(popup.container, 'related__back'));
        await settle();
        expect(findAll(popup.container, 'related')).toHaveLength(0);
        expect(caret.focused).toBe(true);
    });

    it('asks for no links at popup open and none on a second entry of the same title', async () => {
        const popup = await mountOverlayPopup({
            cards: [animeCard('9', 'Berserk'), animeCard('10', 'Vagabond')],
            related: [relatedItem('sequel', animeCard('11', 'Berserk 1997'))],
        });
        await vi.waitFor(() => expect(findAll(popup.container, 'card')).toHaveLength(2));
        // Opening the popup, switching nothing: the screen costs zero requests
        // until it is entered (docs/06, DoD of phase 12).
        expect(popup.asked).toEqual([]);

        clickFocusing(popup.doc, find(cardByTitle(popup.container, 'Berserk'), 'card__related'));
        await vi.waitFor(() => expect(findAll(popup.container, 'related-row')).toHaveLength(1));
        expect(popup.asked).toHaveLength(1);

        clickOn(find(popup.container, 'related__back'));
        await settle();
        clickFocusing(popup.doc, find(cardByTitle(popup.container, 'Berserk'), 'card__related'));
        await settle();

        // Straight from memory: rows on screen, nothing on the wire.
        expect(findAll(popup.container, 'related-row')).toHaveLength(1);
        expect(popup.asked).toHaveLength(1);
    });

    it('freezes the covered tabs while the overlay is open, and thaws them on the way back', async () => {
        const popup = await mountOverlayPopup({
            cards: [animeCard('9', 'Berserk')],
            rows: [listRow()],
            related: [relatedItem('sequel', animeCard('11', 'Berserk 1997'))],
        });
        await vi.waitFor(() => expect(findAll(popup.container, 'card')).toHaveLength(1));

        // Closed: no `inert` anywhere. The binding is true/undefined and never
        // false — `inert` is not one of Vue's special boolean attributes, so on
        // the attribute path a `false` is written out as inert="false", and
        // presence is what freezes a box: the tabs would never come back.
        expect(find(popup.container, 'app__tabs').props.inert).toBeUndefined();
        expect(inertElements(popup.container)).toHaveLength(0);

        clickFocusing(popup.doc, find(popup.container, 'card__related'));
        await vi.waitFor(() => expect(findAll(popup.container, 'related')).toHaveLength(1));

        // Open: Tab stops at the overlay instead of walking into the covered
        // tab, and a screen reader stops reading rows nobody can see.
        expect(find(popup.container, 'app__tabs').props.inert).toBe(true);
        // Exactly one box is frozen, and it is the tabs one.
        const frozen = inertElements(popup.container);
        expect(frozen).toHaveLength(1);
        expect(frozen[0]).toBe(find(popup.container, 'app__tabs'));

        clickOn(find(popup.container, 'related__back'));
        await settle();

        expect(findAll(popup.container, 'related')).toHaveLength(0);
        expect(find(popup.container, 'app__tabs').props.inert).toBeUndefined();
        expect(inertElements(popup.container)).toHaveLength(0);

        // Live again, not merely visible: the tab row answers a click.
        clickOn(findAll(popup.container, 'tabs__tab')[1]!);
        await vi.waitFor(() => expect(findAll(popup.container, 'rate')).toHaveLength(1));
    });

    it('keeps the header and the overlay itself out of the frozen box', async () => {
        const popup = await mountOverlayPopup({
            cards: [animeCard('9', 'Berserk')],
            related: [relatedItem('sequel', animeCard('11', 'Berserk 1997'))],
        });
        await vi.waitFor(() => expect(findAll(popup.container, 'card')).toHaveLength(1));
        const tabsBox = find(popup.container, 'app__tabs');
        const tabBar = find(popup.container, 'tabs');

        clickFocusing(popup.doc, find(popup.container, 'card__related'));
        await vi.waitFor(() => expect(findAll(popup.container, 'related')).toHaveLength(1));

        // The wrapper holds exactly what the overlay covers — the tab row and
        // all three tabs, still mounted underneath (v-show, not v-if) — and it
        // is the same box as before, so opening the screen re-mounts nothing.
        expect(find(popup.container, 'app__tabs')).toBe(tabsBox);
        expect(tabsBox.contains(tabBar)).toBe(true);
        expect(findAll(tabsBox, 'card')).toHaveLength(1);
        expect(findAll(tabsBox, 'lists')).toHaveLength(1);
        expect(findAll(tabsBox, 'calendar')).toHaveLength(1);

        // ⚙ and «Выйти» must answer from every screen, and the overlay must not
        // freeze itself: both live outside the inert box, as siblings of it and
        // above it.
        const overlay = find(popup.container, 'related');
        const header = find(popup.container, 'header');
        const body = find(popup.container, 'app__body');
        expect(tabsBox.contains(overlay)).toBe(false);
        expect(tabsBox.contains(header)).toBe(false);
        expect(overlay.parent).toBe(body);
        expect(tabsBox.parent).toBe(body);
        expect(body.contains(header)).toBe(false);
    });

    it('keeps an open status menu while the posters land under it', async () => {
        const hold = deferred<void>();
        const popup = await mountOverlayPopup({
            cards: [animeCard('9', 'Berserk')],
            related: [relatedItem('sequel', animeCard('11', 'Berserk 1997', { posterUrl: null }))],
            posters: { anime: { '11': 'https://shikimori.io/anime-11.jpg' } },
            holdPosters: hold.promise,
        });
        await vi.waitFor(() => expect(findAll(popup.container, 'card')).toHaveLength(1));

        clickFocusing(popup.doc, find(popup.container, 'card__related'));
        await vi.waitFor(() => expect(findAll(popup.container, 'related-row')).toHaveLength(1));

        clickFocusing(popup.doc, find(popup.container, 'related-row__caret'), true);
        await nextTick();
        expect(findAll(popup.container, 'menu')).toHaveLength(1);

        // The backfill replaces the whole card array with the same rows: a menu
        // opened a moment earlier must not be swept away by a picture.
        hold.resolve(undefined);
        await vi.waitFor(() =>
            expect(find(popup.container, 'related-row__poster').props.src).toBe(
                'https://shikimori.io/anime-11.jpg',
            ),
        );
        expect(findAll(popup.container, 'menu')).toHaveLength(1);
    });

    it('backfills the posters of a mixed list per bucket, without crossing the ids', async () => {
        const manga = mangaCard('21', 'Manga title');
        const ranobe = mangaCard('7', 'Ranobe title');
        const popup = await mountOverlayPopup({
            cards: [animeCard('9', 'Berserk')],
            related: [
                // Anime 21 and manga 21 are two different works with one number:
                // a bare-id poster merge would hang one picture on the other.
                relatedItem('sequel', animeCard('21', 'Anime title', { posterUrl: null })),
                relatedItem('adaptation', { ...manga, kind: 'manga' }),
                relatedItem('adaptation', { ...ranobe, kind: 'light_novel' }),
            ],
            posters: {
                anime: { '21': 'https://shikimori.io/anime-21.jpg' },
                manga: { '21': 'https://shikimori.io/manga-21.jpg' },
                ranobe: { '7': 'https://shikimori.io/ranobe-7.jpg' },
            },
        });
        await vi.waitFor(() => expect(findAll(popup.container, 'card')).toHaveLength(1));

        clickFocusing(popup.doc, find(popup.container, 'card__related'));
        await vi.waitFor(() => expect(findAll(popup.container, 'related-row')).toHaveLength(3));

        // One message per bucket, three buckets, never one per title.
        await vi.waitFor(() => expect(popup.posters).toHaveLength(3));
        expect([...popup.posters].sort((a, b) => a.type.localeCompare(b.type))).toEqual([
            { type: 'anime', ids: ['21'] },
            { type: 'manga', ids: ['21'] },
            { type: 'ranobe', ids: ['7'] },
        ]);

        await vi.waitFor(() =>
            expect(
                find(relatedRow(popup.container, 'Anime title'), 'related-row__poster').props.src,
            ).toBe('https://shikimori.io/anime-21.jpg'),
        );
        expect(
            find(relatedRow(popup.container, 'Manga title'), 'related-row__poster').props.src,
        ).toBe('https://shikimori.io/manga-21.jpg');
        expect(
            find(relatedRow(popup.container, 'Ranobe title'), 'related-row__poster').props.src,
        ).toBe('https://shikimori.io/ranobe-7.jpg');
    });
});
