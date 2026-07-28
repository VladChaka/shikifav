import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import background from '@/entrypoints/background';
import { sendMessage } from '../messaging';
import { setLocal, setSettings } from '../storage';
import type { LocalState } from '../storage';
import { fetchPosters } from './posters';
import { ensureToken } from './auth';
import { rateLimiter, setTokenProvider } from './http';
import type { ApiError, User } from './types';

// Ф6-27: GraphQL answers poster: null for part of the catalogue (every 18+ title
// checked live: animes 1342 / 48755 / 50634), while the REST index returns their
// `image`. This layer tops such a page up with ONE batch request.

const fetchMock = vi.fn<typeof fetch>();

const testUser: User = { id: 7, nickname: 'tester', avatarUrl: 'https://cdn.test/x160.png' };

function storedAuth(): NonNullable<LocalState['auth']> {
    return {
        accessToken: 'stored-access',
        refreshToken: 'stored-refresh',
        expiresAt: Date.now() + 60 * 60 * 1000,
        user: testUser,
    };
}

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status });
}

// Live wire shape (checked 2026-07-28): relative paths, cache-busting query.
function restTitle(id: number): { id: number; image: Record<string, string> } {
    return {
        id,
        image: {
            original: `/system/animes/original/${id}.jpg?1711979744`,
            preview: `/system/animes/preview/${id}.jpg?1711979744`,
            x96: `/system/animes/x96/${id}.jpg?1711979744`,
            x48: `/system/animes/x48/${id}.jpg?1711979744`,
        },
    };
}

function requestedUrls(): string[] {
    return fetchMock.mock.calls.map(([input]) => String(input));
}

async function expectApiErrorThrow(promise: Promise<unknown>): Promise<ApiError> {
    try {
        await promise;
    } catch (e) {
        return e as ApiError;
    }
    throw new Error('Expected the promise to reject');
}

describe('fetchPosters', () => {
    beforeEach(async () => {
        fakeBrowser.reset();
        fetchMock.mockReset();
        vi.stubGlobal('fetch', fetchMock);
        setTokenProvider(ensureToken);
        vi.spyOn(fakeBrowser.contextMenus.onClicked, 'addListener').mockImplementation(() => {});
        rateLimiter.reset();
        await setLocal('auth', storedAuth());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('asks for every id in ONE request and maps the relative path onto the origin', async () => {
        fetchMock.mockResolvedValueOnce(
            jsonResponse(200, [restTitle(1342), restTitle(48755), restTitle(50634)]),
        );

        await expect(fetchPosters('anime', ['1342', '48755', '50634'])).resolves.toEqual({
            '1342': 'https://shikimori.io/system/animes/x96/1342.jpg?1711979744',
            '48755': 'https://shikimori.io/system/animes/x96/48755.jpg?1711979744',
            '50634': 'https://shikimori.io/system/animes/x96/50634.jpg?1711979744',
        });

        // One request per page, never one per title (CLAUDE.md rule 2). `limit`
        // is mandatory: without it the endpoint answers with a single record.
        expect(requestedUrls()).toEqual([
            'https://shikimori.io/api/animes?ids=1342,48755,50634&limit=3',
        ]);
    });

    it('builds the poster url on the origin from the settings, never a hardcoded domain', async () => {
        await setSettings({ origin: 'https://shikimori.one' });
        fetchMock.mockResolvedValueOnce(jsonResponse(200, [restTitle(1342)]));

        await expect(fetchPosters('anime', ['1342'])).resolves.toEqual({
            '1342': 'https://shikimori.one/system/animes/x96/1342.jpg?1711979744',
        });
        expect(requestedUrls()[0].startsWith('https://shikimori.one/api/animes')).toBe(true);
    });

    it('routes manga and ranobe to their own endpoints', async () => {
        // /api/mangas?ids= silently drops light_novel/novel ids, so ranobe has
        // to go to /api/ranobe (checked live 2026-07-28).
        // A fresh Response per call: a body can only be read once.
        fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, [])));

        await fetchPosters('manga', ['2']);
        await fetchPosters('ranobe', ['81669']);

        expect(requestedUrls()).toEqual([
            'https://shikimori.io/api/mangas?ids=2&limit=1',
            'https://shikimori.io/api/ranobe?ids=81669&limit=1',
        ]);
    });

    it('makes no request at all for an empty id list', async () => {
        await expect(fetchPosters('anime', [])).resolves.toEqual({});
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('deduplicates ids and drops non-numeric ones', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(200, [restTitle(1342)]));

        await fetchPosters('anime', ['1342', '1342', 'not-an-id', '']);

        expect(requestedUrls()).toEqual(['https://shikimori.io/api/animes?ids=1342&limit=1']);
    });

    it('skips the site placeholder served for a title with no poster', async () => {
        // /assets/globals/missing_x96.jpg is what the API returns for a title
        // without a picture — the local fallback of the card is better.
        fetchMock.mockResolvedValueOnce(
            jsonResponse(200, [
                { id: 64695, image: { x96: '/assets/globals/missing_x96.jpg' } },
                restTitle(1342),
            ]),
        );

        await expect(fetchPosters('anime', ['64695', '1342'])).resolves.toEqual({
            '1342': 'https://shikimori.io/system/animes/x96/1342.jpg?1711979744',
        });
    });

    it('leaves out ids the API does not answer for', async () => {
        // An unknown id is simply absent from the response (checked live).
        fetchMock.mockResolvedValueOnce(jsonResponse(200, [restTitle(1342)]));

        await expect(fetchPosters('anime', ['1342', '999999999'])).resolves.toEqual({
            '1342': 'https://shikimori.io/system/animes/x96/1342.jpg?1711979744',
        });
    });

    it('survives an item without a usable image', async () => {
        fetchMock.mockResolvedValueOnce(
            jsonResponse(200, [
                { id: 1, image: null },
                { id: 2 },
                { id: 3, image: {} },
                { id: 4, image: { x96: '' } },
                { id: 5, image: { x96: 'javascript:alert(1)' } },
                { id: 6, image: { x96: 'https://cdn.test/system/x96/6.jpg' } },
            ]),
        );

        await expect(fetchPosters('anime', ['1', '2', '3', '4', '5', '6'])).resolves.toEqual({
            // An absolute https url is taken as is; anything else is dropped.
            '6': 'https://cdn.test/system/x96/6.jpg',
        });
    });

    it('propagates an API failure as an ApiError', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(500, { message: 'boom' }));

        const error = await expectApiErrorThrow(fetchPosters('anime', ['1342']));
        expect(error.kind).toBe('api');
    });

    describe('posters.fetch message (docs/02 protocol)', () => {
        it('answers the popup with the backfilled map', async () => {
            background.main();
            fetchMock.mockResolvedValueOnce(jsonResponse(200, [restTitle(1342)]));

            const response = await sendMessage('posters.fetch', {
                type: 'anime',
                ids: ['1342'],
            });

            expect(response).toEqual({
                ok: true,
                data: {
                    posters: {
                        '1342': 'https://shikimori.io/system/animes/x96/1342.jpg?1711979744',
                    },
                },
            });
        });

        it('reports a failure as an error response instead of throwing', async () => {
            background.main();
            fetchMock.mockResolvedValueOnce(jsonResponse(500, {}));

            const response = await sendMessage('posters.fetch', { type: 'anime', ids: ['1342'] });

            expect(response.ok).toBe(false);
        });
    });
});
