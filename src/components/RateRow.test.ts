import { afterEach, describe, expect, it } from 'vitest';
import { h } from 'vue';
import type { Component } from 'vue';
import RateRowView from './RateRow.vue';
import type { RateRow } from '@/src/lib/api/types';
import { createApp, createFakeElement, find, findAll, fire, textOf } from './fake-renderer';
import type { FakeElement } from './fake-renderer';

// Ф6-26: a list row links to the title page from its poster and its name, the
// same contract as TitleCard. What matters extra here is that the link does not
// take over the row controls — [+1], the score button and the status badge keep
// working (they sit outside the linked areas). Mounted through the shared fake
// renderer.

const TITLE_URL = 'https://shikimori.io/animes/52991-sousou-no-frieren';

function row(overrides: Partial<RateRow> = {}): RateRow {
    return {
        rateId: '311',
        targetId: '52991',
        targetType: 'Anime',
        name: 'Sousou no Frieren',
        russian: 'Провожающая в последний путь Фрирен',
        posterUrl: 'https://desu.shikimori.one/uploads/poster/animes/52991/mini.webp',
        posterUrl2x: 'https://desu.shikimori.one/uploads/poster/animes/52991/mini@2x.webp',
        status: 'watching',
        score: 8,
        progress: 27,
        total: 28,
        url: TITLE_URL,
        ...overrides,
    };
}

interface Mounted {
    container: FakeElement;
    events: string[];
}

let cleanups: Array<() => void> = [];

// The score and status buttons carry @click.stop, so the event stub needs the
// method Vue's `stop` modifier calls (the shared clickOn passes a bare target).
function click(el: FakeElement): void {
    fire(el, 'click', { target: el, stopPropagation: () => {} });
}

function mountRow(data: RateRow): Mounted {
    const events: string[] = [];
    const container = createFakeElement('#container');
    const app = createApp({
        render: () =>
            // Same SFC-to-Component cast as in the other component tests;
            // runtime props are the exact RateRow contract.
            h(RateRowView as unknown as Component, {
                rate: data,
                busy: false,
                suggestCompleted: false,
                onIncrement: () => events.push('increment'),
                'onUpdate:scoreOpen': (open: boolean) => events.push(`score:${String(open)}`),
                'onUpdate:statusOpen': (open: boolean) => events.push(`status:${String(open)}`),
            }),
    });
    app.mount(container);
    cleanups.push(() => app.unmount());
    return { container, events };
}

afterEach(() => {
    for (const cleanup of cleanups) {
        cleanup();
    }
    cleanups = [];
});

describe('RateRow title page links (Ф6-26)', () => {
    it('renders the poster as a new-tab link to the title page', () => {
        const box = find(mountRow(row()).container, 'rate__poster-box');
        expect(box.tag).toBe('a');
        expect(box.props.href).toBe(TITLE_URL);
        expect(box.props.target).toBe('_blank');
        expect(box.props.rel).toBe('noopener noreferrer');
        expect(box.props.tabindex).toBe('-1');
        expect(box.props['aria-hidden']).toBe('true');
    });

    it('renders the name as a new-tab link inside the heading', () => {
        const { container } = mountRow(row());
        const link = find(container, 'rate__title-link');
        expect(link.tag).toBe('a');
        expect(link.props.href).toBe(TITLE_URL);
        expect(link.props.target).toBe('_blank');
        expect(link.props.rel).toBe('noopener noreferrer');

        const heading = find(container, 'rate__title');
        expect(heading.tag).toBe('h3');
        expect(textOf(heading).trim()).toBe('Провожающая в последний путь Фрирен');
    });

    it('renders a row from an older session cache (no url) without links', () => {
        const noUrl = row();
        delete noUrl.url;
        const { container } = mountRow(noUrl);

        const box = find(container, 'rate__poster-box');
        expect(box.tag).toBe('div');
        expect(box.props.href).toBeUndefined();
        expect(findAll(container, 'rate__title-link')).toHaveLength(0);
        expect(find(container, 'rate__poster').props.src).toBe(row().posterUrl);
        expect(textOf(find(container, 'rate__title')).trim()).toBe(
            'Провожающая в последний путь Фрирен',
        );
    });

    // Ф6-27: same poster chain as in TitleCard, ending in the bundled image.
    it('falls back to the local image when the row has no poster', () => {
        const { container } = mountRow(row({ posterUrl: null, posterUrl2x: null }));
        const poster = find(container, 'rate__poster');
        expect(poster.tag).toBe('img');
        expect(String(poster.props.src)).toContain('poster-fallback');
        expect(poster.props.srcset).toBeUndefined();
        // Unchanged 42x58 box.
        expect(poster.props.width).toBe('42');
        expect(poster.props.height).toBe('58');
    });

    it('uses a backfilled poster with no 2x pair as a plain src', () => {
        const backfilled = 'https://shikimori.io/system/animes/x96/1342.jpg?1711979744';
        const { container } = mountRow(row({ posterUrl: backfilled, posterUrl2x: null }));
        const poster = find(container, 'rate__poster');
        expect(poster.props.src).toBe(backfilled);
        expect(poster.props.srcset).toBeUndefined();
    });

    it('keeps a non-https url out of href', () => {
        for (const url of ['javascript:alert(1)', 'http://shikimori.io/animes/52991', 'nonsense']) {
            const { container } = mountRow(row({ url }));
            const box = find(container, 'rate__poster-box');
            expect(box.tag).toBe('div');
            expect(box.props.href).toBeUndefined();
            expect(findAll(container, 'rate__title-link')).toHaveLength(0);
        }
    });

    it('leaves the row controls outside the links: [+1], score and badge still fire', () => {
        const { container, events } = mountRow(row());
        click(find(container, 'rate__inc'));
        click(find(container, 'rate__score-btn'));
        click(find(container, 'rate__badge'));
        expect(events).toEqual(['increment', 'score:true', 'status:true']);
        // None of the three sits inside a link.
        for (const className of ['rate__inc', 'rate__score-btn', 'rate__badge']) {
            expect(findAll(find(container, 'rate__poster-box'), className)).toHaveLength(0);
            expect(findAll(find(container, 'rate__title-link'), className)).toHaveLength(0);
        }
    });
});
