import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { onMessage } from './messaging';
import type { MessageHandlers } from './messaging';
import { applyPosters, fetchMissingPosters } from './poster-backfill';
import type { PosterHolder } from './poster-backfill';

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

function handlers(overrides: Partial<MessageHandlers>): MessageHandlers {
    return {
        ping: async () => ({ pong: true }),
        'auth.getState': async () => ({ status: 'anonymous' }),
        'auth.login': async () => ({ user: { id: 1, nickname: 'tester', avatarUrl: '' } }),
        'auth.logout': async () => ({}),
        'search.titles': async () => ({ items: [] }),
        'rates.list': async () => ({ items: [], hasMore: false }),
        'calendar.list': async () => ({ items: [] }),
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
