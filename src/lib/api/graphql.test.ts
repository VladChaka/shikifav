import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import background from '@/entrypoints/background';
import { sendMessage } from '../messaging';
import { setLocal } from '../storage';
import type { LocalState } from '../storage';
import { mapAnimeToTitleCard, searchTitles } from './graphql';
import type { RawAnime } from './graphql';
import { ensureToken } from './auth';
import { rateLimiter, setTokenProvider } from './http';
import type { ApiError, TitleCard, User } from './types';

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

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
    return new Response(JSON.stringify(body), { status, headers });
}

interface CapturedRequest {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: unknown;
}

function capturedRequests(): CapturedRequest[] {
    return fetchMock.mock.calls.map(([input, init]) => ({
        url: String(input),
        method: init?.method ?? 'GET',
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    }));
}

async function expectApiErrorThrow(promise: Promise<unknown>): Promise<ApiError> {
    try {
        await promise;
    } catch (e) {
        return e as ApiError;
    }
    throw new Error('Expected the promise to reject');
}

// Realistic wire fixture: shape from the docs/03 reference query and the live
// public request of 2026-07-23.
const fullRawAnime: RawAnime = {
    id: '52991',
    malId: '52991',
    name: 'Sousou no Frieren',
    russian: 'Провожающая в последний путь Фрирен',
    kind: 'tv',
    score: 9.11,
    status: 'released',
    episodes: 28,
    episodesAired: 28,
    airedOn: { year: 2023 },
    poster: {
        miniUrl: 'https://desu.shikimori.one/uploads/poster/animes/52991/mini.webp',
        mini2xUrl: 'https://desu.shikimori.one/uploads/poster/animes/52991/mini@2x.webp',
    },
    userRate: { id: '311', status: 'watching' },
};

const fullTitleCard: TitleCard = {
    id: '52991',
    name: 'Sousou no Frieren',
    russian: 'Провожающая в последний путь Фрирен',
    kind: 'tv',
    score: 9.11,
    status: 'released',
    episodes: 28,
    episodesAired: 28,
    year: 2023,
    posterUrl: 'https://desu.shikimori.one/uploads/poster/animes/52991/mini.webp',
    posterUrl2x: 'https://desu.shikimori.one/uploads/poster/animes/52991/mini@2x.webp',
    userRate: { id: '311', status: 'watching' },
};

describe('graphql', () => {
    beforeEach(() => {
        fakeBrowser.reset();
        fetchMock.mockReset();
        vi.stubGlobal('fetch', fetchMock);
        // Mirrors the registration in entrypoints/background.ts.
        setTokenProvider(ensureToken);
        // Fresh sliding window: leftover timestamps would delay this test.
        rateLimiter.reset();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe('mapAnimeToTitleCard', () => {
        it('maps a full title 1:1', () => {
            expect(mapAnimeToTitleCard(fullRawAnime)).toEqual(fullTitleCard);
        });

        it('maps userRate: null (anonymous or not in my list) to null', () => {
            const card = mapAnimeToTitleCard({ ...fullRawAnime, userRate: null });
            expect(card.userRate).toBeNull();
        });

        it('maps poster: null to null poster urls', () => {
            const card = mapAnimeToTitleCard({ ...fullRawAnime, poster: null });
            expect(card.posterUrl).toBeNull();
            expect(card.posterUrl2x).toBeNull();
        });

        it('maps an announcement without score and year', () => {
            const announcement: RawAnime = {
                ...fullRawAnime,
                score: null,
                status: 'anons',
                episodes: 0,
                episodesAired: 0,
                airedOn: { year: null },
                userRate: null,
            };
            expect(mapAnimeToTitleCard(announcement)).toEqual({
                ...fullTitleCard,
                score: null,
                status: 'anons',
                episodes: 0,
                episodesAired: 0,
                year: null,
                userRate: null,
            });
        });

        it('maps a missing airedOn object to year: null', () => {
            expect(mapAnimeToTitleCard({ ...fullRawAnime, airedOn: null }).year).toBeNull();
        });
    });

    describe('searchTitles', () => {
        it('POSTs SearchAnimes with PositiveInt variables and maps the response', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(
                jsonResponse(200, { data: { animes: [fullRawAnime] } }),
            );

            await expect(searchTitles('frieren', 'anime')).resolves.toEqual([fullTitleCard]);

            const request = capturedRequests()[0];
            expect(request.url).toBe('https://shikimori.io/api/graphql');
            expect(request.method).toBe('POST');
            expect(request.headers['Authorization']).toBe('Bearer stored-access');
            expect(request.headers['Content-Type']).toBe('application/json');

            const body = request.body as { query: string; variables: Record<string, unknown> };
            expect(body.variables).toEqual({ search: 'frieren', limit: 10, page: 1 });
            expect(body.query).toContain('query SearchAnimes');
            // PositiveInt, not Int: the server rejects Int variables (docs/03).
            expect(body.query).toContain('$limit: PositiveInt');
            expect(body.query).toContain('$page: PositiveInt');
            expect(body.query).toContain('poster { miniUrl mini2xUrl }');
            expect(body.query).toContain('userRate { id status }');
        });

        it('passes an explicit page through to the variables', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { animes: [] } }));

            await expect(searchTitles('frieren', 'anime', 3)).resolves.toEqual([]);

            const body = capturedRequests()[0].body as { variables: Record<string, unknown> };
            expect(body.variables).toEqual({ search: 'frieren', limit: 10, page: 3 });
        });

        it('maps 200 + errors[] to an api error with the first message', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(
                jsonResponse(200, {
                    errors: [
                        { message: 'Query has depth of 7, which exceeds max depth of 5' },
                        { message: 'second error' },
                    ],
                }),
            );

            const error = await expectApiErrorThrow(searchTitles('frieren', 'anime'));
            expect(error).toEqual({
                kind: 'api',
                status: 200,
                message: 'Query has depth of 7, which exceeds max depth of 5',
            });
        });

        it('treats an empty errors[] alongside data as success', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(
                jsonResponse(200, { data: { animes: [fullRawAnime] }, errors: [] }),
            );

            await expect(searchTitles('frieren', 'anime')).resolves.toEqual([fullTitleCard]);
        });

        it('falls back to a generic message when the first error has none', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(jsonResponse(200, { errors: [{}] }));

            const error = await expectApiErrorThrow(searchTitles('frieren', 'anime'));
            expect(error).toEqual({ kind: 'api', status: 200, message: 'GraphQL error' });
        });

        it('maps an explicit data: null to an internal error', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: null }));

            const error = await expectApiErrorThrow(searchTitles('frieren', 'anime'));
            expect(error).toEqual({ kind: 'internal', message: 'GraphQL response has no data' });
        });

        it('maps a 200 without data or errors to an internal error', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));

            const error = await expectApiErrorThrow(searchTitles('frieren', 'anime'));
            expect(error).toEqual({ kind: 'internal', message: 'GraphQL response has no data' });
        });

        it('retries on 429: the read opts in despite being a POST', async () => {
            await setLocal('auth', storedAuth());
            fetchMock
                .mockResolvedValueOnce(
                    new Response('', { status: 429, headers: { 'Retry-After': '0' } }),
                )
                .mockResolvedValueOnce(jsonResponse(200, { data: { animes: [fullRawAnime] } }));

            await expect(searchTitles('frieren', 'anime')).resolves.toEqual([fullTitleCard]);
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });

        it('propagates http-level errors as is', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(new Response('Bad gateway', { status: 502 }));

            const error = await expectApiErrorThrow(searchTitles('frieren', 'anime'));
            expect(error).toEqual({ kind: 'api', status: 502, message: 'Bad gateway' });
        });

        it('throws internal "not implemented" for manga and ranobe without network', async () => {
            for (const type of ['manga', 'ranobe'] as const) {
                const error = await expectApiErrorThrow(searchTitles('overlord', type));
                expect(error).toMatchObject({ kind: 'internal' });
                expect((error as { message: string }).message).toContain('not implemented');
            }
            expect(fetchMock).not.toHaveBeenCalled();
        });
    });

    describe('background search.titles handler', () => {
        it('responds with mapped items over messaging', async () => {
            background.main();
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(
                jsonResponse(200, { data: { animes: [fullRawAnime] } }),
            );

            const response = await sendMessage('search.titles', {
                query: 'frieren',
                type: 'anime',
            });
            expect(response).toEqual({ ok: true, data: { items: [fullTitleCard] } });
        });

        it('keeps the ApiError kind of a GraphQL failure on the wire', async () => {
            background.main();
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(
                jsonResponse(200, { errors: [{ message: 'Field is missing' }] }),
            );

            const response = await sendMessage('search.titles', {
                query: 'frieren',
                type: 'anime',
            });
            expect(response).toEqual({
                ok: false,
                error: { kind: 'api', status: 200, message: 'Field is missing' },
            });
        });
    });
});
