import { afterEach, describe, expect, it } from 'vitest';
import { h } from 'vue';
import type { Component } from 'vue';
import TitleCardView from './TitleCard.vue';
import type { TitleCard } from '@/src/lib/api/types';
import { createApp, createFakeElement, find, findAll, textOf } from './fake-renderer';
import type { FakeElement } from './fake-renderer';

// Ф6-26: the poster and the name of a card open the title page on Shikimori in
// a new tab. The url arrives with the card (API data on the current origin, no
// url building in the UI) and may be absent — a card restored from a session
// cache written by an older build carries none. Mounted through the shared
// fake renderer; a link is asserted by its href/target/rel props, no navigation
// happens here.

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

let cleanups: Array<() => void> = [];

function mountCard(data: TitleCard): FakeElement {
    const container = createFakeElement('#container');
    const app = createApp({
        // Same SFC-to-Component cast as in the other component tests.
        render: () => h(TitleCardView as unknown as Component, { card: data }),
    });
    app.mount(container);
    cleanups.push(() => app.unmount());
    return container;
}

afterEach(() => {
    for (const cleanup of cleanups) {
        cleanup();
    }
    cleanups = [];
});

describe('TitleCard title page links (Ф6-26)', () => {
    it('renders the poster as a new-tab link to the title page', () => {
        const box = find(mountCard(card()), 'card__poster-box');
        expect(box.tag).toBe('a');
        expect(box.props.href).toBe(TITLE_URL);
        expect(box.props.target).toBe('_blank');
        expect(box.props.rel).toBe('noopener noreferrer');
        // The poster repeats the destination of the name link: out of the tab
        // order and out of the a11y tree.
        expect(box.props.tabindex).toBe('-1');
        expect(box.props['aria-hidden']).toBe('true');
    });

    it('renders the name as a new-tab link inside the heading', () => {
        const container = mountCard(card());
        const link = find(container, 'card__title-link');
        expect(link.tag).toBe('a');
        expect(link.props.href).toBe(TITLE_URL);
        expect(link.props.target).toBe('_blank');
        expect(link.props.rel).toBe('noopener noreferrer');
        // The link lives inside the <h3>, so the heading semantics and the
        // two-line clamp of .card__title stay untouched.
        const heading = find(container, 'card__title');
        expect(heading.tag).toBe('h3');
        expect(textOf(heading).trim()).toBe('Провожающая в последний путь Фрирен');
        expect(findAll(heading, 'card__title-link')).toHaveLength(1);
    });

    it('links to the domain of the response, whatever it is', () => {
        const oneUrl = 'https://shikimori.one/animes/52991-sousou-no-frieren';
        const container = mountCard(card({ url: oneUrl }));
        expect(find(container, 'card__poster-box').props.href).toBe(oneUrl);
        expect(find(container, 'card__title-link').props.href).toBe(oneUrl);
    });

    it('renders a card from an older session cache (no url) without links', () => {
        const noUrl = card();
        delete noUrl.url;
        const container = mountCard(noUrl);

        const box = find(container, 'card__poster-box');
        expect(box.tag).toBe('div');
        expect(box.props.href).toBeUndefined();
        expect(findAll(container, 'card__title-link')).toHaveLength(0);
        // Everything else still renders: the poster and the name are there.
        expect(find(container, 'card__poster').props.src).toBe(card().posterUrl);
        expect(textOf(find(container, 'card__title')).trim()).toBe(
            'Провожающая в последний путь Фрирен',
        );
    });

    it('renders an explicit null url the same way', () => {
        const container = mountCard(card({ url: null }));
        expect(find(container, 'card__poster-box').tag).toBe('div');
        expect(findAll(container, 'card__title-link')).toHaveLength(0);
    });

    it('keeps a non-https url out of href', () => {
        for (const url of [
            'javascript:alert(1)',
            'http://shikimori.io/animes/52991',
            '/animes/1',
        ]) {
            const container = mountCard(card({ url }));
            const box = find(container, 'card__poster-box');
            expect(box.tag).toBe('div');
            expect(box.props.href).toBeUndefined();
            expect(findAll(container, 'card__title-link')).toHaveLength(0);
        }
    });
});
