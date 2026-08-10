import { afterEach, describe, expect, it, vi } from 'vitest';
import { h, nextTick, ref } from 'vue';
import type { Component } from 'vue';
import RelatedScreen from './RelatedScreen.vue';
import type { RelatedPortion, RelatedStatus, RelatedTarget } from '@/src/composables/use-related';
import type { RelatedItem, RelationKind, TitleCard, UserRateStatus } from '@/src/lib/api/types';
import { i18n } from '@/src/lib/i18n';
import { groupRelated } from '@/src/lib/related';
import {
    clickOn,
    createApp,
    createFakeElement,
    find,
    findAll,
    fire,
    textOf,
} from './fake-renderer';
import type { FakeElement } from './fake-renderer';

// Ф12-8: the «Связанные» overlay itself — the four data states, the return bar
// that is drawn in every one of them, the group headings with their counters,
// the portion button, and the two rules the screen owns on top of the rows:
// at most one status menu across the list, and Escape that belongs to the menu
// while a menu is open. The data flow (request, cache, portions) is covered in
// composables/use-related.test.ts; the row itself in RelatedRow.test.ts.
//
// Mounted through the shared fake renderer, so props are the exact runtime
// contract of the component and no DOM is involved.

const TARGET: RelatedTarget = {
    targetId: '21',
    targetType: 'Anime',
    name: 'One Piece',
    russian: 'Ван-Пис',
};

function card(id: string, overrides: Partial<TitleCard> = {}): TitleCard {
    return {
        id,
        targetType: 'Anime',
        name: `Title ${id}`,
        russian: null,
        kind: 'tv',
        score: null,
        status: null,
        year: 2000,
        posterUrl: null,
        posterUrl2x: null,
        userRate: null,
        ...overrides,
    };
}

function item(kind: RelationKind, id: string, overrides: Partial<TitleCard> = {}): RelatedItem {
    return { relationKind: kind, relationText: 'Связь', card: card(id, overrides) };
}

// The screen renders whatever use-related computed for it, so the groups of a
// test are built by the very same pure layer the composable uses.
function portionsOf(items: RelatedItem[], shown = items.length): RelatedPortion[] {
    let budget = shown;
    const portions: RelatedPortion[] = [];
    for (const group of groupRelated(items)) {
        if (budget <= 0) {
            break;
        }
        const portion = group.items.slice(0, budget);
        budget -= portion.length;
        portions.push({ kind: group.kind, items: portion, all: group.items });
    }
    return portions;
}

interface MountProps {
    screenStatus: RelatedStatus;
    errorText?: string;
    groups?: RelatedPortion[];
    shown?: number;
    total?: number;
    hasMore?: boolean;
}

interface Mounted {
    container: FakeElement;
    readonly closes: number;
    readonly retries: number;
    readonly loadMores: number;
}

let cleanups: Array<() => void> = [];

// The screen and the status menu both listen on the document, and this
// environment has none (vitest-environment-node-client.ts) — so the stub is the
// keydown registry plus the two methods they call. `press` walks the listeners
// in registration order, which is the order a browser would call them in.
interface FakeDocument {
    press(key: string): void;
    readonly keydownListeners: number;
}

function stubDocument(): FakeDocument {
    const keydown = new Set<(event: { key: string }) => void>();
    vi.stubGlobal('document', {
        addEventListener(type: string, handler: unknown): void {
            if (type === 'keydown') {
                keydown.add(handler as (event: { key: string }) => void);
            }
        },
        removeEventListener(type: string, handler: unknown): void {
            if (type === 'keydown') {
                keydown.delete(handler as (event: { key: string }) => void);
            }
        },
    });
    return {
        press(key: string): void {
            for (const handler of [...keydown]) {
                handler({ key });
            }
        },
        get keydownListeners(): number {
            return keydown.size;
        },
    };
}

function mountScreen(props: MountProps): Mounted {
    const state = { closes: 0, retries: 0, loadMores: 0 };
    const container = createFakeElement('#container');
    const app = createApp({
        render: () =>
            // Same SFC-to-Component cast as in the other component tests;
            // runtime props are the exact RelatedScreen contract.
            h(RelatedScreen as unknown as Component, {
                target: TARGET,
                groups: [],
                shown: 0,
                total: 0,
                hasMore: false,
                ...props,
                onClose: () => {
                    state.closes += 1;
                },
                onRetry: () => {
                    state.retries += 1;
                },
                onLoadMore: () => {
                    state.loadMores += 1;
                },
            }),
    });
    app.mount(container);
    cleanups.push(() => app.unmount());
    return {
        container,
        get closes(): number {
            return state.closes;
        },
        get retries(): number {
            return state.retries;
        },
        get loadMores(): number {
            return state.loadMores;
        },
    };
}

// A screen whose `groups` prop can be replaced afterwards — which is what
// use-related does on EVERY change of the cards underneath: `groups` is a
// computed, so the poster backfill, a rate write and a switch to another title
// all hand down a brand-new array of brand-new portion objects. Only the last of
// the three may close an open menu.
interface ReactiveScreen {
    container: FakeElement;
    setGroups(next: RelatedPortion[]): Promise<void>;
    readonly closes: number;
}

function mountReactiveScreen(initial: RelatedPortion[]): ReactiveScreen {
    const rendered = ref(initial);
    const state = { closes: 0 };
    const container = createFakeElement('#container');
    const app = createApp({
        render: () =>
            h(RelatedScreen as unknown as Component, {
                target: TARGET,
                screenStatus: 'data',
                groups: rendered.value,
                shown: rendered.value.reduce((count, group) => count + group.items.length, 0),
                total: rendered.value.reduce((count, group) => count + group.all.length, 0),
                hasMore: false,
                onClose: () => {
                    state.closes += 1;
                },
            }),
    });
    app.mount(container);
    cleanups.push(() => app.unmount());
    return {
        container,
        async setGroups(next: RelatedPortion[]): Promise<void> {
            rendered.value = next;
            await nextTick();
        },
        get closes(): number {
            return state.closes;
        },
    };
}

// The same row one field later: what the mixed poster backfill sends down.
function withPoster(entry: RelatedItem): RelatedItem {
    return {
        ...entry,
        card: { ...entry.card, posterUrl: `https://cdn.test/${entry.card.id}.jpg` },
    };
}

// The same row after a confirmed write: what useRates patches into the cards.
function withRate(entry: RelatedItem, status: UserRateStatus): RelatedItem {
    return {
        ...entry,
        card: { ...entry.card, userRate: { id: '77', status } },
    };
}

// The status-menu trigger of a row carries @click.stop, so the event stub needs
// the method Vue's `stop` modifier calls.
function click(el: FakeElement): void {
    fire(el, 'click', { target: el, stopPropagation: () => {} });
}

function squash(node: FakeElement): string {
    return textOf(node).replace(/\s+/g, ' ').trim();
}

function headings(container: FakeElement): string[] {
    return findAll(container, 'list-heading').map(squash);
}

function rowTitles(container: FakeElement): string[] {
    return findAll(container, 'related-row__title').map(squash);
}

afterEach(() => {
    for (const cleanup of cleanups) {
        cleanup();
    }
    cleanups = [];
    vi.unstubAllGlobals();
});

describe('RelatedScreen states (Ф12-8)', () => {
    it('renders the skeleton while the request runs, with the way out already working', () => {
        stubDocument();
        const mounted = mountScreen({ screenStatus: 'skeleton' });

        expect(findAll(mounted.container, 'skeleton__row').length).toBeGreaterThan(0);
        expect(findAll(mounted.container, 'related-row')).toHaveLength(0);
        expect(findAll(mounted.container, 'empty')).toHaveLength(0);
        expect(findAll(mounted.container, 'error')).toHaveLength(0);
        // The return bar is drawn in every state, the skeleton included: the row
        // the user came from is covered by this very screen.
        expect(squash(find(mounted.container, 'related__target'))).toBe('Ван-Пис');
        clickOn(find(mounted.container, 'related__back'));
        expect(mounted.closes).toBe(1);
    });

    it('renders the rows grouped, each heading carrying the size of its group', () => {
        stubDocument();
        const { container } = mountScreen({
            screenStatus: 'data',
            groups: portionsOf([
                item('sequel', '1'),
                item('sequel', '2', { year: 2001 }),
                item('adaptation', '3', { targetType: 'Manga', kind: 'manga' }),
            ]),
            shown: 3,
            total: 3,
        });

        expect(headings(container)).toEqual(['Продолжение 2', 'Первоисточник 1']);
        expect(rowTitles(container)).toEqual(['Title 1', 'Title 2', 'Title 3']);
        expect(findAll(container, 'skeleton__row')).toHaveLength(0);
    });

    it('renders the related empty state with its own text and icon', () => {
        stubDocument();
        const { container } = mountScreen({ screenStatus: 'empty' });

        expect(squash(find(container, 'empty__text'))).toBe(i18n.related.empty);
        expect(squash(find(container, 'empty__icon'))).toBe('🔗');
        expect(findAll(container, 'related-row')).toHaveLength(0);
        // Leaving a title without links must still be one click.
        expect(findAll(container, 'related__back')).toHaveLength(1);
    });

    it('renders the error text with a retry that reaches the owner', () => {
        stubDocument();
        const mounted = mountScreen({ screenStatus: 'error', errorText: i18n.errors.network });

        expect(squash(find(mounted.container, 'error__text'))).toBe(i18n.errors.network);
        clickOn(find(mounted.container, 'error__retry'));
        expect(mounted.retries).toBe(1);
        expect(mounted.closes).toBe(0);
    });

    it('falls back to a generic message when the error carries no text', () => {
        stubDocument();
        const { container } = mountScreen({ screenStatus: 'error' });
        expect(squash(find(container, 'error__text'))).toBe(i18n.errors.internal);
    });

    it('gives the caret to the way out as soon as it opens', () => {
        stubDocument();
        const { container } = mountScreen({ screenStatus: 'skeleton' });
        expect(find(container, 'related__back').focused).toBe(true);
    });
});

describe('RelatedScreen portions (Ф12-8)', () => {
    const many = Array.from({ length: 92 }, (_, index) => item('side_story', `s${index}`));

    it('says how much is on screen and asks the owner for the next portion', () => {
        stubDocument();
        const mounted = mountScreen({
            screenStatus: 'data',
            groups: portionsOf(many, 30),
            shown: 30,
            total: 92,
            hasMore: true,
        });

        expect(findAll(mounted.container, 'related-row')).toHaveLength(30);
        expect(squash(find(mounted.container, 'related__shown'))).toBe('Показано 30 из 92');
        // The heading counter shows the WHOLE group, not the portion.
        expect(headings(mounted.container)).toEqual(['Побочные истории 92']);

        clickOn(find(mounted.container, 'list-more-btn'));
        expect(mounted.loadMores).toBe(1);
    });

    it('drops the button and the counter once everything is rendered', () => {
        stubDocument();
        const { container } = mountScreen({
            screenStatus: 'data',
            groups: portionsOf(many),
            shown: 92,
            total: 92,
            hasMore: false,
        });

        expect(findAll(container, 'related-row')).toHaveLength(92);
        expect(findAll(container, 'related__more')).toHaveLength(0);
        expect(findAll(container, 'list-more-btn')).toHaveLength(0);
        expect(findAll(container, 'related__shown')).toHaveLength(0);
    });
});

describe('RelatedScreen unknown relation kinds (Ф12-8)', () => {
    it('renders a kind the union does not know under «Прочее», keeping its row', () => {
        stubDocument();
        // What a server-side addition to RelationKindEnum looks like here: the
        // value is typed but arrives from the wire, so the cast is the test.
        const unknown: RelatedItem = {
            relationKind: 'crossover' as RelationKind,
            relationText: 'Кроссовер',
            card: card('9', { name: 'Crossed', russian: 'Кроссовер-тайтл' }),
        };
        const { container } = mountScreen({
            screenStatus: 'data',
            groups: portionsOf([item('sequel', '1'), unknown]),
            shown: 2,
            total: 2,
        });

        expect(headings(container)).toEqual(['Продолжение 1', 'Прочее 1']);
        expect(rowTitles(container)).toEqual(['Title 1', 'Кроссовер-тайтл']);
        // The row keeps the server's own wording of the link, which is the only
        // thing that still describes an unfamiliar relation.
        const meta = findAll(container, 'related-row__meta').map(squash);
        expect(meta[1]).toContain('Кроссовер');
    });
});

describe('RelatedScreen status menu and Escape (Ф12-8)', () => {
    const groups = (): RelatedPortion[] =>
        portionsOf([item('sequel', '1'), item('sequel', '2', { year: 2001 })]);

    function openMenuOfRow(container: FakeElement, index: number): Promise<void> {
        click(findAll(container, 'related-row__caret')[index]!);
        return nextTick();
    }

    it('keeps at most one open menu across the list', async () => {
        stubDocument();
        const { container } = mountScreen({
            screenStatus: 'data',
            groups: groups(),
            shown: 2,
            total: 2,
        });

        await openMenuOfRow(container, 0);
        expect(findAll(container, 'menu')).toHaveLength(1);
        expect(findAll(findAll(container, 'related-row')[0]!, 'menu')).toHaveLength(1);

        await openMenuOfRow(container, 1);
        expect(findAll(container, 'menu')).toHaveLength(1);
        expect(findAll(findAll(container, 'related-row')[1]!, 'menu')).toHaveLength(1);
    });

    it('offers no way from these links to another title’s links', async () => {
        stubDocument();
        const { container } = mountScreen({
            screenStatus: 'data',
            groups: groups(),
            shown: 2,
            total: 2,
        });

        await openMenuOfRow(container, 0);
        // Six statuses and nothing else: the removal needs a userRate, and the
        // «Связанные тайтлы» item must not exist here at all (docs/06,
        // decision 4) — the return bar knows exactly one step back.
        expect(findAll(container, 'menu__item')).toHaveLength(6);
        expect(findAll(container, 'menu__item--nav')).toHaveLength(0);
        expect(squash(find(container, 'menu'))).not.toContain(i18n.related.open);
    });

    it('Escape closes an open menu and leaves the screen where it was', async () => {
        const doc = stubDocument();
        const mounted = mountScreen({
            screenStatus: 'data',
            groups: groups(),
            shown: 2,
            total: 2,
        });

        await openMenuOfRow(mounted.container, 0);
        doc.press('Escape');
        await nextTick();

        expect(findAll(mounted.container, 'menu')).toHaveLength(0);
        expect(mounted.closes).toBe(0);

        // With the menu gone the next Escape is the screen's own.
        doc.press('Escape');
        expect(mounted.closes).toBe(1);
    });

    it('Escape closes the screen when no menu is open', () => {
        const doc = stubDocument();
        const mounted = mountScreen({ screenStatus: 'data', groups: groups(), shown: 2, total: 2 });

        doc.press('Escape');
        expect(mounted.closes).toBe(1);
    });

    it('ignores every other key', () => {
        const doc = stubDocument();
        const mounted = mountScreen({ screenStatus: 'data', groups: groups(), shown: 2, total: 2 });

        for (const key of ['Enter', 'Esc', 'a', 'Tab']) {
            doc.press(key);
        }
        expect(mounted.closes).toBe(0);
    });

    it('does not leave a menu hanging over rows that are gone', async () => {
        stubDocument();
        const screen = mountReactiveScreen(groups());

        await openMenuOfRow(screen.container, 0);
        expect(findAll(screen.container, 'menu')).toHaveLength(1);

        // Another title, or the next portion: the rows under the menu are not
        // the ones it was opened over.
        await screen.setGroups(
            portionsOf([item('prequel', '7'), item('prequel', '8', { year: 2002 })]),
        );

        expect(findAll(screen.container, 'menu')).toHaveLength(0);
        expect(rowTitles(screen.container)).toEqual(['Title 7', 'Title 8']);
    });

    it('gives Escape back to the screen once the row its menu belonged to is gone', async () => {
        const doc = stubDocument();
        const screen = mountReactiveScreen(groups());

        await openMenuOfRow(screen.container, 0);
        await screen.setGroups(portionsOf([item('prequel', '7')]));

        // A key matching no row draws nothing, so the render alone cannot tell a
        // cleared openMenuKey from a stale one. Escape can: while the screen
        // believes a menu is open it leaves the key to the menu and refuses to
        // close — the way out would be the arrow and nothing else.
        doc.press('Escape');
        expect(screen.closes).toBe(1);
    });

    it('keeps the open menu when the poster backfill replaces the list with the same rows', async () => {
        stubDocument();
        const rows = [item('sequel', '1'), item('sequel', '2', { year: 2001 })];
        const screen = mountReactiveScreen(portionsOf(rows));

        await openMenuOfRow(screen.container, 0);
        expect(findAll(screen.container, 'menu')).toHaveLength(1);

        // Ф6-27 for a mixed list: the pictures land a moment after the rows and
        // arrive as a NEW array of NEW cards — the same titles, the same keys,
        // one field later. Watching array identity closed the menu right here,
        // for no reason the user could see.
        await screen.setGroups(portionsOf(rows.map(withPoster)));

        expect(findAll(screen.container, 'menu')).toHaveLength(1);
        // Still on the row it was opened over, not merely somewhere on screen.
        expect(findAll(findAll(screen.container, 'related-row')[0]!, 'menu')).toHaveLength(1);
        // The posters did arrive — the case is «survived a real update», not
        // «nothing happened».
        expect(findAll(screen.container, 'related-row__poster').map((el) => el.props.src)).toEqual([
            'https://cdn.test/1.jpg',
            'https://cdn.test/2.jpg',
        ]);
    });

    it('keeps the open menu when a rate write replaces the list', async () => {
        stubDocument();
        const rows = [item('sequel', '1'), item('sequel', '2', { year: 2001 })];
        const screen = mountReactiveScreen(portionsOf(rows));

        // The menu of the SECOND row, while a write started from the first one
        // is still in flight: useRates patches that card in place, the groups
        // computed rebuilds, and the whole array comes down again.
        await openMenuOfRow(screen.container, 1);
        expect(findAll(findAll(screen.container, 'related-row')[1]!, 'menu')).toHaveLength(1);

        await screen.setGroups(portionsOf([withRate(rows[0]!, 'watching'), rows[1]!]));

        const after = findAll(screen.container, 'related-row');
        expect(findAll(screen.container, 'menu')).toHaveLength(1);
        expect(findAll(after[1]!, 'menu')).toHaveLength(1);
        // The write landed: the first row wears its status badge now.
        expect(findAll(after[0]!, 'related-row__badge')).toHaveLength(1);
    });

    it('takes its keydown listener with it when it closes', () => {
        const doc = stubDocument();
        const mounted = mountScreen({ screenStatus: 'empty' });
        expect(doc.keydownListeners).toBe(1);

        for (const cleanup of cleanups) {
            cleanup();
        }
        cleanups = [];

        expect(doc.keydownListeners).toBe(0);
        doc.press('Escape');
        expect(mounted.closes).toBe(0);
    });
});
