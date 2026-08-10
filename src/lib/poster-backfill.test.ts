import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { onMessage } from './messaging';
import type { MessageHandlers } from './messaging';
import {
    applyMixedPosters,
    applyPosters,
    fetchMissingMixedPosters,
    fetchMissingPosters,
} from './poster-backfill';
import type { PosterHolder } from './poster-backfill';
import { cardKey } from './title-card';
import type { SearchType, TitleCard } from './api/types';

// Ф6-27, UI half of the poster chain: collect the ids whose poster GraphQL did
// not return, ask background once, patch the result in.

interface Item extends PosterHolder {
    id: string;
    posterUrl: string | null;
    posterUrl2x: string | null;
}

function item(id: string, posterUrl: string | null = null): Item {
    return { id, posterUrl, posterUrl2x: posterUrl === null ? null : `${posterUrl}@2x` };
}

const idOf = (value: Item): string => value.id;

// A card with no poster, which is the only kind the backfill looks at. `kind`
// carries the whole weight of the manga/ranobe split (posterTypeOf,
// title-card.ts).
function cardOf(id: string, targetType: TitleCard['targetType'], kind = 'tv'): TitleCard {
    return {
        id,
        targetType,
        name: `Title ${id}`,
        russian: null,
        kind,
        score: null,
        status: null,
        year: null,
        posterUrl: null,
        posterUrl2x: null,
        userRate: null,
    };
}

function handlers(overrides: Partial<MessageHandlers>): MessageHandlers {
    return {
        ping: async () => ({ pong: true }),
        'auth.getState': async () => ({ status: 'anonymous' }),
        'auth.login': async () => ({ user: { id: 1, nickname: 'tester', avatarUrl: '' } }),
        'auth.logout': async () => ({}),
        'search.titles': async () => ({ items: [] }),
        'rates.list': async () => ({ items: [], hasMore: false }),
        'calendar.list': async () => ({ items: [] }),
        'titles.related': async () => ({ items: [] }),
        'posters.fetch': async () => ({ posters: {} }),
        'rates.create': async () => ({ rate: { id: '1', status: 'planned' } }),
        'rates.update': async () => ({
            rate: { id: '1', status: 'watching', score: 0, episodes: 0, chapters: 0, volumes: 0 },
        }),
        'rates.delete': async () => ({}),
        'rates.increment': async () => ({
            rate: { id: '1', status: 'watching', score: 0, episodes: 0, chapters: 0, volumes: 0 },
        }),
        'settings.setOrigin': async () => ({}),
        'analytics.track': async () => ({}),
        ...overrides,
    };
}

describe('fetchMissingPosters', () => {
    beforeEach(() => {
        fakeBrowser.reset();
    });

    it('asks only for the items whose poster is empty', async () => {
        const asked: { type: string; ids: string[] }[] = [];
        onMessage(
            handlers({
                'posters.fetch': async ({ type, ids }) => {
                    asked.push({ type, ids });
                    return { posters: { '2': 'https://shikimori.io/x96/2.jpg' } };
                },
            }),
        );

        const items = [item('1', 'https://shikimori.io/mini/1.webp'), item('2'), item('3')];
        await expect(fetchMissingPosters(items, 'anime', idOf)).resolves.toEqual({
            '2': 'https://shikimori.io/x96/2.jpg',
        });

        // A title that already has a poster must not cost a batch slot.
        expect(asked).toEqual([{ type: 'anime', ids: ['2', '3'] }]);
    });

    it('sends nothing when every item already has a poster', async () => {
        const asked: string[][] = [];
        onMessage(
            handlers({
                'posters.fetch': async ({ ids }) => {
                    asked.push(ids);
                    return { posters: {} };
                },
            }),
        );

        const items = [item('1', 'https://shikimori.io/mini/1.webp')];
        await expect(fetchMissingPosters(items, 'anime', idOf)).resolves.toEqual({});
        expect(asked).toEqual([]);
    });

    it('passes the list type through, so ranobe reaches its own endpoint', async () => {
        const types: string[] = [];
        onMessage(
            handlers({
                'posters.fetch': async ({ type }) => {
                    types.push(type);
                    return { posters: {} };
                },
            }),
        );

        await fetchMissingPosters([item('1')], 'ranobe', idOf);
        expect(types).toEqual(['ranobe']);
    });

    it('stays silent on a failure: an empty map, no throw', async () => {
        onMessage(
            handlers({
                'posters.fetch': async () => {
                    throw { kind: 'network' };
                },
            }),
        );

        await expect(fetchMissingPosters([item('1')], 'anime', idOf)).resolves.toEqual({});
    });
});

describe('fetchMissingMixedPosters', () => {
    beforeEach(() => {
        fakeBrowser.reset();
    });

    it('splits a mixed list into one message per bucket, ranobe included', async () => {
        const asked: { type: SearchType; ids: string[] }[] = [];
        onMessage(
            handlers({
                'posters.fetch': async ({ type, ids }) => {
                    asked.push({ type, ids });
                    return { posters: {} };
                },
            }),
        );

        await fetchMissingMixedPosters([
            cardOf('1', 'Anime'),
            cardOf('2', 'Manga', 'manga'),
            cardOf('3', 'Manga', 'light_novel'),
        ]);

        // Order of the buckets is the record's, not the list's — what matters is
        // that each type went to its own endpoint and none of them was merged.
        expect([...asked].sort((a, b) => a.type.localeCompare(b.type))).toEqual([
            { type: 'anime', ids: ['1'] },
            { type: 'manga', ids: ['2'] },
            { type: 'ranobe', ids: ['3'] },
        ]);
    });

    it('keys the result by (targetType, id), so an anime and a manga sharing an id do not collide', async () => {
        onMessage(
            handlers({
                'posters.fetch': async ({ type }) => ({
                    posters: { '21': `https://shikimori.io/x96/${type}-21.jpg` },
                }),
            }),
        );

        await expect(
            fetchMissingMixedPosters([cardOf('21', 'Anime'), cardOf('21', 'Manga', 'manga')]),
        ).resolves.toEqual(
            new Map([
                [cardKey(cardOf('21', 'Anime')), 'https://shikimori.io/x96/anime-21.jpg'],
                [cardKey(cardOf('21', 'Manga', 'manga')), 'https://shikimori.io/x96/manga-21.jpg'],
            ]),
        );
    });

    it('sends nothing for the buckets that are empty or already have posters', async () => {
        const asked: SearchType[] = [];
        onMessage(
            handlers({
                'posters.fetch': async ({ type }) => {
                    asked.push(type);
                    return { posters: {} };
                },
            }),
        );

        const withPoster = { ...cardOf('9', 'Anime'), posterUrl: 'https://shikimori.io/9.webp' };
        await fetchMissingMixedPosters([withPoster, cardOf('2', 'Manga', 'manga')]);

        // Three buckets never mean three requests: only the non-empty ones cost
        // anything (CLAUDE.md rule 2).
        expect(asked).toEqual(['manga']);
    });

    it('keeps the buckets that answered when another one fails', async () => {
        onMessage(
            handlers({
                'posters.fetch': async ({ type }) => {
                    if (type === 'anime') {
                        throw { kind: 'network' };
                    }
                    return { posters: { '2': 'https://shikimori.io/x96/2.jpg' } };
                },
            }),
        );

        await expect(
            fetchMissingMixedPosters([cardOf('1', 'Anime'), cardOf('2', 'Manga', 'manga')]),
        ).resolves.toEqual(
            new Map([[cardKey(cardOf('2', 'Manga', 'manga')), 'https://shikimori.io/x96/2.jpg']]),
        );
    });

    it('sends nothing at all for an empty list', async () => {
        const asked: SearchType[] = [];
        onMessage(
            handlers({
                'posters.fetch': async ({ type }) => {
                    asked.push(type);
                    return { posters: {} };
                },
            }),
        );

        await expect(fetchMissingMixedPosters([])).resolves.toEqual(new Map());
        expect(asked).toEqual([]);
    });
});

// The pair, not the halves: the two functions are useless apart, and the way to
// break them is to key one by (targetType, id) and read the other by bare id —
// which compiles, sends the requests and sets no poster at all. The type system
// now refuses that line (MixedPosterMap is a Map, applyPosters takes a Record),
// and this is the runtime witness that the keys really do meet.
describe('fetchMissingMixedPosters -> applyMixedPosters', () => {
    beforeEach(() => {
        fakeBrowser.reset();
    });

    it('puts every bucket poster on its own card', async () => {
        onMessage(
            handlers({
                'posters.fetch': async ({ type, ids }) => ({
                    posters: Object.fromEntries(
                        ids.map((id) => [id, `https://shikimori.io/x96/${type}-${id}.jpg`]),
                    ),
                }),
            }),
        );

        // Anime 21 and manga 21 share an id — the collision a bare-id map hides.
        const cards = [
            cardOf('21', 'Anime'),
            cardOf('21', 'Manga', 'manga'),
            cardOf('81669', 'Manga', 'light_novel'),
        ];
        const patched = applyMixedPosters(cards, await fetchMissingMixedPosters(cards));

        expect(patched?.map((card) => card.posterUrl)).toEqual([
            'https://shikimori.io/x96/anime-21.jpg',
            'https://shikimori.io/x96/manga-21.jpg',
            'https://shikimori.io/x96/ranobe-81669.jpg',
        ]);
    });

    it('leaves the cards alone when the backfill came back empty', async () => {
        onMessage(handlers({ 'posters.fetch': async () => ({ posters: {} }) }));

        const cards = [cardOf('21', 'Anime')];
        expect(applyMixedPosters(cards, await fetchMissingMixedPosters(cards))).toBeNull();
    });
});

describe('applyMixedPosters', () => {
    it('does not overwrite a poster GraphQL already returned', () => {
        const withPoster = { ...cardOf('21', 'Anime'), posterUrl: 'https://shikimori.io/21.webp' };
        const posters = new Map([[cardKey(withPoster), 'https://shikimori.io/x96/21.jpg']]);
        expect(applyMixedPosters([withPoster], posters)).toBeNull();
    });

    it('does not mutate the cards it was given', () => {
        const cards = [cardOf('21', 'Anime')];
        applyMixedPosters(cards, new Map([[cardKey(cards[0]), 'https://shikimori.io/x96/21.jpg']]));
        expect(cards[0].posterUrl).toBeNull();
    });

    it('ignores a card the map says nothing about', () => {
        const cards = [cardOf('21', 'Anime'), cardOf('22', 'Anime')];
        const patched = applyMixedPosters(
            cards,
            new Map([[cardKey(cards[1]), 'https://shikimori.io/x96/22.jpg']]),
        );
        expect(patched?.map((card) => card.posterUrl)).toEqual([
            null,
            'https://shikimori.io/x96/22.jpg',
        ]);
    });
});

describe('applyPosters', () => {
    it('fills the empty posters and leaves the rest untouched', () => {
        const items = [item('1', 'https://shikimori.io/mini/1.webp'), item('2'), item('3')];
        const patched = applyPosters(
            items,
            {
                '1': 'https://shikimori.io/x96/1.jpg', // must NOT overwrite the GraphQL url
                '2': 'https://shikimori.io/x96/2.jpg',
            },
            idOf,
        );

        expect(patched).toEqual([
            {
                id: '1',
                posterUrl: 'https://shikimori.io/mini/1.webp',
                posterUrl2x: 'https://shikimori.io/mini/1.webp@2x',
            },
            { id: '2', posterUrl: 'https://shikimori.io/x96/2.jpg', posterUrl2x: null },
            { id: '3', posterUrl: null, posterUrl2x: null },
        ]);
    });

    it('returns null when nothing changed, so the caller skips the write', () => {
        const items = [item('1', 'https://shikimori.io/mini/1.webp'), item('2')];
        expect(applyPosters(items, {}, idOf)).toBeNull();
        expect(applyPosters(items, { '9': 'https://shikimori.io/x96/9.jpg' }, idOf)).toBeNull();
    });

    it('does not mutate the items it was given', () => {
        const items = [item('2')];
        applyPosters(items, { '2': 'https://shikimori.io/x96/2.jpg' }, idOf);
        expect(items[0].posterUrl).toBeNull();
    });
});
