import { afterEach, describe, expect, it, vi } from 'vitest';
import { h, nextTick } from 'vue';
import type { Component } from 'vue';
import RelatedRowView from './RelatedRow.vue';
import type { RelatedItem, RelationKind, TitleCard, UserRateStatus } from '@/src/lib/api/types';
import { i18n } from '@/src/lib/i18n';
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

// Ф12-8: one row of the «Связанные» screen. What it owns and nothing else — the
// meta line built from untrusted server text, the title-page link, the single
// action control (no [+1] and no score, docs/06 decision 3) and the status menu
// without a way into another title's links. Mounted through the shared fake
// renderer, so a link is asserted by its href/target/rel props.

const TITLE_URL = 'https://shikimori.io/animes/52991-sousou-no-frieren';

function card(overrides: Partial<TitleCard> = {}): TitleCard {
    return {
        id: '52991',
        targetType: 'Anime',
        name: 'Sousou no Frieren',
        russian: 'Провожающая в последний путь Фрирен',
        kind: 'tv',
        score: 9.1,
        status: 'released',
        episodes: 28,
        episodesAired: 28,
        year: 2023,
        posterUrl: 'https://desu.shikimori.one/uploads/poster/animes/52991/mini.webp',
        posterUrl2x: 'https://desu.shikimori.one/uploads/poster/animes/52991/mini@2x.webp',
        userRate: null,
        url: TITLE_URL,
        ...overrides,
    };
}

function item(overrides: Partial<RelatedItem> = {}): RelatedItem {
    return { relationKind: 'sequel', relationText: 'Продолжение', card: card(), ...overrides };
}

interface Mounted {
    container: FakeElement;
    events: string[];
}

let cleanups: Array<() => void> = [];

// The status trigger carries @click.stop, so the event stub needs the method
// Vue's `stop` modifier calls.
function click(el: FakeElement): void {
    fire(el, 'click', { target: el, stopPropagation: () => {} });
}

function mountRow(data: RelatedItem, menuOpen = false): Mounted {
    const events: string[] = [];
    const container = createFakeElement('#container');
    const app = createApp({
        render: () =>
            // Same SFC-to-Component cast as in the other component tests;
            // runtime props are the exact RelatedRow contract.
            h(RelatedRowView as unknown as Component, {
                item: data,
                menuOpen,
                onAdd: () => events.push('add'),
                onSetStatus: (status: UserRateStatus) => events.push(`set-status:${status}`),
                onRemove: () => events.push('remove'),
                'onUpdate:menuOpen': (open: boolean) => events.push(`menu:${String(open)}`),
            }),
    });
    app.mount(container);
    cleanups.push(() => app.unmount());
    return { container, events };
}

function squash(node: FakeElement): string {
    return textOf(node).replace(/\s+/g, ' ').trim();
}

// The status menu listens on the document, and this environment has none.
function stubDocument(): void {
    vi.stubGlobal('document', {
        addEventListener: () => {},
        removeEventListener: () => {},
    });
}

afterEach(() => {
    for (const cleanup of cleanups) {
        cleanup();
    }
    cleanups = [];
    vi.unstubAllGlobals();
});

describe('RelatedRow meta line (Ф12-8)', () => {
    it('leads with the server wording of the link, then the type and the year', () => {
        const { container } = mountRow(item({ relationText: 'Другая история' }));
        expect(squash(find(container, 'related-row__meta'))).toBe('Другая история · TV · 2023');
    });

    it('drops the parts the answer does not carry', () => {
        const { container } = mountRow(
            item({ relationText: '', card: card({ kind: null, year: null }) }),
        );
        expect(squash(find(container, 'related-row__meta'))).toBe('');
    });

    // relationText is server text and reaches the row verbatim; the row must
    // interpolate it and never treat it as markup.
    it('prints HTML inside the relation text as text, not as markup', () => {
        const hostile = '<img src=x onerror="alert(1)"><b>Адаптация</b>';
        const { container } = mountRow(item({ relationText: hostile }));

        const meta = find(container, 'related-row__meta');
        expect(squash(meta)).toBe(`${hostile} · TV · 2023`);
        // Nothing was parsed: the paragraph holds text nodes only, and no
        // v-html ever set innerHTML on it.
        expect(meta.props.innerHTML).toBeUndefined();
        expect(meta.children.every((child) => child.kind === 'text')).toBe(true);
        expect(findAll(meta, 'related-row__meta')).toHaveLength(1);
        expect(meta.children.some((child) => child.kind === 'element')).toBe(false);
    });

    it('prints HTML inside the title as text as well', () => {
        const hostile = '<script>alert(1)</script>';
        const { container } = mountRow(item({ card: card({ russian: hostile }) }));
        const title = find(container, 'related-row__title');
        expect(squash(title)).toBe(hostile);
        expect(title.props.innerHTML).toBeUndefined();
    });
});

describe('RelatedRow title page link (Ф12-8, Ф6-26)', () => {
    it('renders the poster and the name as new-tab links to the title page', () => {
        const { container } = mountRow(item());

        const box = find(container, 'related-row__poster-box');
        expect(box.tag).toBe('a');
        expect(box.props.href).toBe(TITLE_URL);
        expect(box.props.target).toBe('_blank');
        expect(box.props.rel).toBe('noopener noreferrer');
        // The poster repeats the destination of the name link: out of the tab
        // order and out of the a11y tree.
        expect(box.props.tabindex).toBe('-1');
        expect(box.props['aria-hidden']).toBe('true');

        const link = find(container, 'related-row__title-link');
        expect(link.props.href).toBe(TITLE_URL);
        expect(link.props.target).toBe('_blank');
        expect(link.props.rel).toBe('noopener noreferrer');
    });

    it('links to the domain of the response, whatever it is', () => {
        const oneUrl = 'https://shikimori.one/mangas/7-berserk';
        const { container } = mountRow(item({ card: card({ url: oneUrl }) }));
        expect(find(container, 'related-row__poster-box').props.href).toBe(oneUrl);
        expect(find(container, 'related-row__title-link').props.href).toBe(oneUrl);
    });

    // titleHref() is the only gate: anything but https renders as plain text.
    it('keeps a non-https url out of href', () => {
        for (const url of [
            'javascript:alert(1)',
            'http://shikimori.io/animes/52991',
            '/animes/1',
            'nonsense',
        ]) {
            const { container } = mountRow(item({ card: card({ url }) }));
            const box = find(container, 'related-row__poster-box');
            expect(box.tag).toBe('div');
            expect(box.props.href).toBeUndefined();
            expect(findAll(container, 'related-row__title-link')).toHaveLength(0);
            // The name is still on screen, just not clickable.
            expect(squash(find(container, 'related-row__title'))).toBe(
                'Провожающая в последний путь Фрирен',
            );
        }
    });

    it('renders a card without a url the same way', () => {
        const noUrl = card();
        delete noUrl.url;
        const { container } = mountRow(item({ card: noUrl }));
        expect(find(container, 'related-row__poster-box').tag).toBe('div');
        expect(findAll(container, 'related-row__title-link')).toHaveLength(0);
    });
});

describe('RelatedRow poster (Ф12-8, Ф6-27)', () => {
    it('falls back to the local image in the same 42×58 box', () => {
        const { container } = mountRow(
            item({ card: card({ posterUrl: null, posterUrl2x: null }) }),
        );
        const poster = find(container, 'related-row__poster');
        expect(String(poster.props.src)).toContain('poster-fallback');
        expect(poster.props.srcset).toBeUndefined();
        expect(poster.props.width).toBe('42');
        expect(poster.props.height).toBe('58');
    });

    it('uses a backfilled poster with no 2x pair as a plain src', () => {
        const backfilled = 'https://shikimori.io/system/animes/x96/1342.jpg?1711979744';
        const { container } = mountRow(
            item({ card: card({ posterUrl: backfilled, posterUrl2x: null }) }),
        );
        const poster = find(container, 'related-row__poster');
        expect(poster.props.src).toBe(backfilled);
        expect(poster.props.srcset).toBeUndefined();
    });
});

describe('RelatedRow actions (Ф12-8)', () => {
    it('offers one write control and neither [+1] nor a score picker', () => {
        const { container } = mountRow(item());
        const control = find(container, 'related-row__control');
        const buttons = control.children.flatMap((child) =>
            child.kind === 'element' ? [child] : [],
        );
        // The split button only: «+ Запланировано» and its caret.
        expect(findAll(control, 'related-row__add')).toHaveLength(1);
        expect(findAll(control, 'related-row__caret')).toHaveLength(1);
        expect(buttons).toHaveLength(1); // the <span> wrapping the split button
        expect(findAll(container, 'rate__inc')).toHaveLength(0);
        expect(findAll(container, 'score')).toHaveLength(0);
    });

    it('adds with the quick status and labels itself with it', () => {
        const { container, events } = mountRow(item());
        const add = find(container, 'related-row__add');
        expect(squash(add)).toBe('+ Запланировано');
        clickOn(add);
        expect(events).toEqual(['add']);
    });

    it('shows the badge instead of the split button for a title in my list', () => {
        const { container } = mountRow(
            item({ card: card({ userRate: { id: '5', status: 'watching' } }) }),
        );
        expect(findAll(container, 'related-row__add')).toHaveLength(0);
        expect(squash(find(container, 'related-row__badge'))).toContain('Смотрю');
    });

    // The list mixes media, so the wording follows the ROW and not the title
    // the screen was opened from.
    it('words the status of a manga row as a book', () => {
        const { container } = mountRow(
            item({
                card: card({
                    targetType: 'Manga',
                    kind: 'manga',
                    userRate: { id: '5', status: 'watching' },
                }),
            }),
        );
        expect(squash(find(container, 'related-row__badge'))).toContain('Читаю');
    });

    it('hides a 0.0 score and shows a real one', () => {
        const zero = mountRow(item({ card: card({ score: 0 }) }));
        expect(findAll(zero.container, 'related-row__score')).toHaveLength(0);
        const scored = mountRow(item());
        expect(squash(find(scored.container, 'related-row__score'))).toBe('9.1');
    });

    it('locks the control while a write for this title is in flight', () => {
        const container = createFakeElement('#container');
        const app = createApp({
            render: () => h(RelatedRowView as unknown as Component, { item: item(), busy: true }),
        });
        app.mount(container);
        cleanups.push(() => app.unmount());
        expect(find(container, 'related-row__add').props.disabled).toBe(true);
        expect(find(container, 'related-row__caret').props.disabled).toBe(true);
    });

    it('renders the inline warning the screen handed it', () => {
        const container = createFakeElement('#container');
        const app = createApp({
            render: () =>
                h(RelatedRowView as unknown as Component, {
                    item: item(),
                    warning: i18n.errors.editForbidden,
                }),
        });
        app.mount(container);
        cleanups.push(() => app.unmount());
        const warning = find(container, 'related-row__warning');
        expect(squash(warning)).toBe(i18n.errors.editForbidden);
        expect(warning.props.role).toBe('alert');
    });
});

describe('RelatedRow status menu (Ф12-8)', () => {
    it('asks the screen to open it and reports the picked status', async () => {
        stubDocument();
        const { container, events } = mountRow(item());
        click(find(container, 'related-row__caret'));
        expect(events).toEqual(['menu:true']);

        const menu = mountRow(item(), true);
        await nextTick();
        clickOn(findAll(menu.container, 'menu__item')[1]!); // watching
        expect(menu.events).toEqual(['menu:false', 'set-status:watching']);
    });

    it('spends no request on re-picking the status the title already has', async () => {
        stubDocument();
        const { container, events } = mountRow(
            item({ card: card({ userRate: { id: '5', status: 'watching' } }) }),
            true,
        );
        await nextTick();
        clickOn(findAll(container, 'menu__item')[1]!); // watching again
        expect(events).toEqual(['menu:false']);
    });

    it('has no «Связанные тайтлы» item: this screen is the end of that road', async () => {
        stubDocument();
        const { container } = mountRow(
            item({ card: card({ userRate: { id: '5', status: 'watching' } }) }),
            true,
        );
        await nextTick();
        // Six statuses plus the removal, and nothing between them (docs/06,
        // decision 4).
        expect(findAll(container, 'menu__item')).toHaveLength(7);
        expect(findAll(container, 'menu__item--nav')).toHaveLength(0);
        expect(squash(find(container, 'menu'))).not.toContain(i18n.related.open);
        expect(findAll(container, 'menu__item--danger')).toHaveLength(1);
    });

    it('reports a removal once and closes itself', async () => {
        stubDocument();
        const { container, events } = mountRow(
            item({ card: card({ userRate: { id: '5', status: 'watching' } }) }),
            true,
        );
        await nextTick();
        clickOn(find(container, 'menu__item--danger'));
        expect(events).toEqual(['menu:false', 'remove']);
    });

    it('keeps an unfamiliar relation kind from touching the controls', () => {
        const { container } = mountRow(
            item({ relationKind: 'crossover' as RelationKind, relationText: 'Кроссовер' }),
        );
        expect(squash(find(container, 'related-row__meta'))).toBe('Кроссовер · TV · 2023');
        expect(findAll(container, 'related-row__add')).toHaveLength(1);
    });
});
