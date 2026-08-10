import { describe, expect, it } from 'vitest';
import { cardKey, posterTypeOf, RANOBE_KINDS, splitCardsByType } from './title-card';
import type { TitleCard } from './api/types';

function card(overrides: Partial<TitleCard> = {}): TitleCard {
    return {
        id: '1',
        targetType: 'Anime',
        name: 'Title',
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

describe('cardKey', () => {
    it('separates the two id spaces, and keeps ranobe in the manga one', () => {
        // The same string is the dedup key of the related screen (related.ts)
        // and the poster key in poster-backfill.ts, where three maps are merged
        // into one.
        expect(cardKey(card({ id: '21', targetType: 'Anime' }))).toBe('Anime:21');
        expect(cardKey(card({ id: '21', targetType: 'Manga' }))).not.toBe(
            cardKey(card({ id: '21', targetType: 'Anime' })),
        );
        expect(cardKey(card({ id: '81669', targetType: 'Manga', kind: 'light_novel' }))).toBe(
            'Manga:81669',
        );
    });
});

describe('RANOBE_KINDS', () => {
    it('holds the two MangaKindEnum values the site calls ранобэ', () => {
        // Spelled out here as the second witness: this list also builds the
        // mangas() kind filter of the search (SEARCH_TYPE_TO_KIND, graphql.ts),
        // and its own test pins the resulting strings.
        expect([...RANOBE_KINDS]).toEqual(['light_novel', 'novel']);
    });
});

describe('posterTypeOf', () => {
    it('routes anime cards to the anime index', () => {
        expect(posterTypeOf(card({ targetType: 'Anime', kind: 'movie' }))).toBe('anime');
    });

    it('routes light novels to the ranobe index', () => {
        expect(posterTypeOf(card({ targetType: 'Manga', kind: 'light_novel' }))).toBe('ranobe');
        expect(posterTypeOf(card({ targetType: 'Manga', kind: 'novel' }))).toBe('ranobe');
    });

    it('routes the remaining manga kinds to the manga index', () => {
        expect(posterTypeOf(card({ targetType: 'Manga', kind: 'manga' }))).toBe('manga');
        expect(posterTypeOf(card({ targetType: 'Manga', kind: 'manhwa' }))).toBe('manga');
        expect(posterTypeOf(card({ targetType: 'Manga', kind: 'one_shot' }))).toBe('manga');
    });

    it('falls back to manga when the kind is unknown', () => {
        expect(posterTypeOf(card({ targetType: 'Manga', kind: null }))).toBe('manga');
    });

    it('decides by targetType first, whatever the kind says', () => {
        // The two fields come from different halves of a Related element, and
        // only targetType names the index: an anime is asked for at /api/animes
        // even if its kind string is one the book branch would recognise.
        expect(posterTypeOf(card({ targetType: 'Anime', kind: null }))).toBe('anime');
        expect(posterTypeOf(card({ targetType: 'Anime', kind: 'light_novel' }))).toBe('anime');
    });
});

describe('splitCardsByType', () => {
    it('returns three buckets even for an empty list', () => {
        expect(splitCardsByType([])).toEqual({ anime: [], manga: [], ranobe: [] });
    });

    it('splits a mixed list the way posters.fetch needs it', () => {
        const anime = card({ id: '1', targetType: 'Anime' });
        const manga = card({ id: '2', targetType: 'Manga', kind: 'manga' });
        const ranobe = card({ id: '3', targetType: 'Manga', kind: 'light_novel' });
        expect(splitCardsByType([manga, ranobe, anime])).toEqual({
            anime: [anime],
            manga: [manga],
            ranobe: [ranobe],
        });
    });

    it('keeps the order inside a bucket', () => {
        const first = card({ id: '1' });
        const second = card({ id: '2' });
        expect(splitCardsByType([first, second]).anime.map((row) => row.id)).toEqual(['1', '2']);
    });
});
