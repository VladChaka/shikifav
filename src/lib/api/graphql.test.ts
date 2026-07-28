import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import background from '@/entrypoints/background';
import { sendMessage } from '../messaging';
import { setLocal } from '../storage';
import type { LocalState } from '../storage';
import {
    LIST_LIMIT,
    SEARCH_TYPE_TO_KIND,
    listRates,
    mapAnimeToRateRow,
    mapAnimeToTitleCard,
    mapMangaToRateRow,
    mapMangaToTitleCard,
    searchTitles,
} from './graphql';
import type { RawAnime, RawManga, RawMylistAnime, RawMylistManga } from './graphql';
import { ensureToken } from './auth';
import { rateLimiter, setTokenProvider } from './http';
import type { ApiError, RateRow, TitleCard, User } from './types';

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
    // Absolute url on the domain the response came from (live check 2026-07-27).
    url: 'https://shikimori.io/animes/52991-sousou-no-frieren',
};

const fullTitleCard: TitleCard = {
    id: '52991',
    targetType: 'Anime',
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
    url: 'https://shikimori.io/animes/52991-sousou-no-frieren',
};

// The same title as read by MYLIST_ANIMES_QUERY: userRate carries progress + score.
const fullRawMylistAnime: RawMylistAnime = {
    ...fullRawAnime,
    userRate: { id: '311', status: 'watching', episodes: 27, score: 9 },
};

const fullRateRow: RateRow = {
    rateId: '311',
    targetId: '52991',
    targetType: 'Anime',
    name: 'Sousou no Frieren',
    russian: 'Провожающая в последний путь Фрирен',
    posterUrl: 'https://desu.shikimori.one/uploads/poster/animes/52991/mini.webp',
    posterUrl2x: 'https://desu.shikimori.one/uploads/poster/animes/52991/mini@2x.webp',
    status: 'watching',
    score: 9,
    progress: 27,
    total: 28,
    url: 'https://shikimori.io/animes/52991-sousou-no-frieren',
};

// Realistic manga wire fixture: shape from the docs/03 SearchMangas template
// (introspection 2026-07-24). A ranobe item has the same shape — only kind differs.
const fullRawManga: RawManga = {
    id: '25',
    name: 'Fullmetal Alchemist',
    russian: 'Стальной алхимик',
    kind: 'manga',
    score: 9.03,
    status: 'released',
    volumes: 27,
    chapters: 116,
    airedOn: { year: 2001 },
    poster: {
        miniUrl: 'https://desu.shikimori.one/uploads/poster/mangas/25/mini.webp',
        mini2xUrl: 'https://desu.shikimori.one/uploads/poster/mangas/25/mini@2x.webp',
    },
    userRate: { id: '512', status: 'watching' },
    url: 'https://shikimori.io/mangas/25-fullmetal-alchemist',
};

// The manga card carries chapters/volumes and NO episode fields; ranobe cards
// also get targetType 'Manga' (REST writes do not distinguish the subtypes).
const fullMangaCard: TitleCard = {
    id: '25',
    targetType: 'Manga',
    name: 'Fullmetal Alchemist',
    russian: 'Стальной алхимик',
    kind: 'manga',
    score: 9.03,
    status: 'released',
    chapters: 116,
    volumes: 27,
    year: 2001,
    posterUrl: 'https://desu.shikimori.one/uploads/poster/mangas/25/mini.webp',
    posterUrl2x: 'https://desu.shikimori.one/uploads/poster/mangas/25/mini@2x.webp',
    userRate: { id: '512', status: 'watching' },
    url: 'https://shikimori.io/mangas/25-fullmetal-alchemist',
};

// The same title as read by MYLIST_MANGAS_QUERY: userRate carries the chapters
// progress + score, the title itself only what mapMangaToRateRow consumes.
const fullRawMylistManga: RawMylistManga = {
    id: '25',
    name: 'Fullmetal Alchemist',
    russian: 'Стальной алхимик',
    chapters: 116,
    poster: {
        miniUrl: 'https://desu.shikimori.one/uploads/poster/mangas/25/mini.webp',
        mini2xUrl: 'https://desu.shikimori.one/uploads/poster/mangas/25/mini@2x.webp',
    },
    userRate: { id: '512', status: 'watching', chapters: 58, score: 9 },
    url: 'https://shikimori.io/mangas/25-fullmetal-alchemist',
};

const fullMangaRateRow: RateRow = {
    rateId: '512',
    targetId: '25',
    targetType: 'Manga',
    name: 'Fullmetal Alchemist',
    russian: 'Стальной алхимик',
    posterUrl: 'https://desu.shikimori.one/uploads/poster/mangas/25/mini.webp',
    posterUrl2x: 'https://desu.shikimori.one/uploads/poster/mangas/25/mini@2x.webp',
    status: 'watching',
    score: 9,
    progress: 58,
    total: 116,
    url: 'https://shikimori.io/mangas/25-fullmetal-alchemist',
};

// Compact mylist item generator for page-size fixtures (hasMore cases).
function mylistAnime(id: number, overrides: Partial<RawMylistAnime> = {}): RawMylistAnime {
    return {
        ...fullRawMylistAnime,
        id: String(id),
        name: `Anime ${id}`,
        userRate: { id: String(1000 + id), status: 'watching', episodes: 3, score: 7 },
        ...overrides,
    };
}

describe('graphql', () => {
    beforeEach(() => {
        fakeBrowser.reset();
        fetchMock.mockReset();
        vi.stubGlobal('fetch', fetchMock);
        // Mirrors the registration in entrypoints/background.ts.
        setTokenProvider(ensureToken);
        // fake-browser has no contextMenus implementation, and background.main()
        // subscribes to onClicked synchronously — stub it out (Ф5-7).
        vi.spyOn(fakeBrowser.contextMenus.onClicked, 'addListener').mockImplementation(() => {});
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

        // Ф6-26: the card links to the title page, and the url comes from the
        // response as is — building it from the origin setting is what rule 4
        // of CLAUDE.md forbids.
        it('carries the url of the title through unchanged', () => {
            expect(mapAnimeToTitleCard(fullRawAnime).url).toBe(
                'https://shikimori.io/animes/52991-sousou-no-frieren',
            );
            expect(
                mapAnimeToTitleCard({
                    ...fullRawAnime,
                    url: 'https://shikimori.one/animes/52991-sousou-no-frieren',
                }).url,
            ).toBe('https://shikimori.one/animes/52991-sousou-no-frieren');
        });

        it('maps a null url to null (the card then renders without a link)', () => {
            expect(mapAnimeToTitleCard({ ...fullRawAnime, url: null }).url).toBeNull();
        });
    });

    describe('mapAnimeToRateRow', () => {
        it('maps a full mylist item to a RateRow with userRate progress and title total', () => {
            expect(mapAnimeToRateRow(fullRawMylistAnime)).toEqual(fullRateRow);
        });

        it('returns null for an item without userRate (dropped by the caller)', () => {
            expect(mapAnimeToRateRow({ ...fullRawMylistAnime, userRate: null })).toBeNull();
        });

        it('maps poster: null to null poster urls', () => {
            const row = mapAnimeToRateRow({ ...fullRawMylistAnime, poster: null });
            expect(row?.posterUrl).toBeNull();
            expect(row?.posterUrl2x).toBeNull();
        });

        it('keeps total = 0 for an ongoing title with an unknown episode count', () => {
            const row = mapAnimeToRateRow({ ...fullRawMylistAnime, episodes: 0 });
            expect(row?.total).toBe(0);
        });

        it('carries the url of the title through, null included (Ф6-26)', () => {
            expect(mapAnimeToRateRow(fullRawMylistAnime)?.url).toBe(
                'https://shikimori.io/animes/52991-sousou-no-frieren',
            );
            expect(mapAnimeToRateRow({ ...fullRawMylistAnime, url: null })?.url).toBeNull();
        });
    });

    describe('mapMangaToTitleCard', () => {
        it('maps a full manga title with chapters/volumes and targetType Manga', () => {
            expect(mapMangaToTitleCard(fullRawManga)).toEqual(fullMangaCard);
        });

        it('maps userRate: null (anonymous or not in my list) to null', () => {
            expect(mapMangaToTitleCard({ ...fullRawManga, userRate: null }).userRate).toBeNull();
        });

        it('survives a null title status and null score/poster/airedOn (announcement)', () => {
            const announcement = mapMangaToTitleCard({
                ...fullRawManga,
                status: null,
                score: null,
                poster: null,
                airedOn: null,
                userRate: null,
            });
            expect(announcement).toEqual({
                ...fullMangaCard,
                status: null,
                score: null,
                posterUrl: null,
                posterUrl2x: null,
                year: null,
                userRate: null,
            });
        });

        it('carries the url of the title through, null included (Ф6-26)', () => {
            expect(mapMangaToTitleCard(fullRawManga).url).toBe(
                'https://shikimori.io/mangas/25-fullmetal-alchemist',
            );
            expect(mapMangaToTitleCard({ ...fullRawManga, url: null }).url).toBeNull();
        });
    });

    describe('mapMangaToRateRow', () => {
        it('maps progress from userRate.chapters and total from the title chapters', () => {
            expect(mapMangaToRateRow(fullRawMylistManga)).toEqual(fullMangaRateRow);
        });

        it('returns null for an item without userRate (dropped by the caller)', () => {
            expect(mapMangaToRateRow({ ...fullRawMylistManga, userRate: null })).toBeNull();
        });

        it('keeps total = 0 for a manga with an unknown chapter count', () => {
            const row = mapMangaToRateRow({ ...fullRawMylistManga, chapters: 0 });
            expect(row?.total).toBe(0);
            expect(row?.progress).toBe(58); // the progress unit stays chapters
        });

        it('carries the url of the title through, null included (Ф6-26)', () => {
            expect(mapMangaToRateRow(fullRawMylistManga)?.url).toBe(
                'https://shikimori.io/mangas/25-fullmetal-alchemist',
            );
            expect(mapMangaToRateRow({ ...fullRawMylistManga, url: null })?.url).toBeNull();
        });
    });

    // Ф6-26: every read that feeds a card or a row must ask for the url, or the
    // title page link silently disappears for one of the four screens.
    describe('url in the read queries', () => {
        it('is requested by both searches and both mylist reads', async () => {
            await setLocal('auth', storedAuth());
            fetchMock
                .mockResolvedValueOnce(jsonResponse(200, { data: { animes: [] } }))
                .mockResolvedValueOnce(jsonResponse(200, { data: { mangas: [] } }))
                .mockResolvedValueOnce(jsonResponse(200, { data: { animes: [] } }))
                .mockResolvedValueOnce(jsonResponse(200, { data: { mangas: [] } }));

            await searchTitles('frieren', 'anime');
            await searchTitles('berserk', 'manga');
            await listRates('anime', 'watching', 1);
            await listRates('manga', 'watching', 1);

            const queries = capturedRequests().map(
                (request) => (request.body as { query: string }).query,
            );
            expect(queries).toHaveLength(4);
            for (const query of queries) {
                // Its own field line: a plain substring check would also match
                // poster { miniUrl mini2xUrl }.
                expect(query).toMatch(/^\s+url$/m);
            }
        });
    });

    describe('SEARCH_TYPE_TO_KIND', () => {
        it('maps exactly: anime — no kind, manga excludes ranobe kinds, ranobe selects them', () => {
            // toEqual ignores undefined-valued keys, so the shape is pinned first.
            expect(Object.keys(SEARCH_TYPE_TO_KIND).sort()).toEqual([
                'anime',
                'manga',
                'ranobe',
            ]);
            expect(SEARCH_TYPE_TO_KIND.anime).toBeUndefined();
            expect(SEARCH_TYPE_TO_KIND.manga).toBe('!light_novel,!novel');
            expect(SEARCH_TYPE_TO_KIND.ranobe).toBe('light_novel,novel');
        });
    });

    describe('listRates', () => {
        it('POSTs MylistAnimes with mylist/limit/page variables', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(
                jsonResponse(200, { data: { animes: [fullRawMylistAnime] } }),
            );

            await expect(listRates('anime', 'watching', 2)).resolves.toEqual({
                items: [fullRateRow],
                hasMore: false,
            });

            const request = capturedRequests()[0];
            expect(request.url).toBe('https://shikimori.io/api/graphql');
            expect(request.method).toBe('POST');

            const body = request.body as { query: string; variables: Record<string, unknown> };
            expect(body.variables).toEqual({ mylist: 'watching', limit: LIST_LIMIT, page: 2 });
            expect(body.query).toContain('query MylistAnimes');
            expect(body.query).toContain('$mylist: MylistString');
            // PositiveInt, not Int: the server rejects Int variables (docs/03).
            expect(body.query).toContain('$limit: PositiveInt');
            expect(body.query).toContain('$page: PositiveInt');
            // The expanded userRate drives RateRow progress/score.
            expect(body.query).toContain('userRate { id status episodes score }');
        });

        it('derives hasMore from the RAW page length, before the userRate filter', async () => {
            await setLocal('auth', storedAuth());
            // A full page of LIST_LIMIT raw items where one lost its userRate:
            // 29 rows survive, but paging must continue (docs/06).
            const rawPage = Array.from({ length: LIST_LIMIT }, (_, i) => mylistAnime(i + 1));
            rawPage[4] = mylistAnime(5, { userRate: null });
            fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { animes: rawPage } }));

            const { items, hasMore } = await listRates('anime', 'watching', 1);
            expect(items).toHaveLength(LIST_LIMIT - 1);
            expect(items.some((row) => row.targetId === '5')).toBe(false);
            expect(hasMore).toBe(true);
        });

        it('reports hasMore: false for a page shorter than LIST_LIMIT', async () => {
            await setLocal('auth', storedAuth());
            const rawPage = Array.from({ length: LIST_LIMIT - 1 }, (_, i) => mylistAnime(i + 1));
            fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { animes: rawPage } }));

            const { items, hasMore } = await listRates('anime', 'watching', 1);
            expect(items).toHaveLength(LIST_LIMIT - 1);
            expect(hasMore).toBe(false);
        });

        it('reports an empty page as no items and no more pages', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { animes: [] } }));

            await expect(listRates('anime', 'watching', 3)).resolves.toEqual({
                items: [],
                hasMore: false,
            });
        });

        it('routes manga and ranobe to MylistMangas with the kind filter', async () => {
            await setLocal('auth', storedAuth());
            fetchMock
                .mockResolvedValueOnce(jsonResponse(200, { data: { mangas: [] } }))
                .mockResolvedValueOnce(jsonResponse(200, { data: { mangas: [] } }));

            await expect(listRates('manga', 'watching', 1)).resolves.toEqual({
                items: [],
                hasMore: false,
            });
            await expect(listRates('ranobe', 'completed', 2)).resolves.toEqual({
                items: [],
                hasMore: false,
            });

            const [mangaRequest, ranobeRequest] = capturedRequests();
            const mangaBody = mangaRequest.body as {
                query: string;
                variables: Record<string, unknown>;
            };
            expect(mangaBody.query).toContain('query MylistMangas');
            expect(mangaBody.query).toContain('$kind: MangaKindString');
            // The trimmed userRate still drives RateRow progress/score.
            expect(mangaBody.query).toContain('userRate { id status chapters score }');
            expect(mangaBody.variables).toEqual({
                mylist: 'watching',
                limit: LIST_LIMIT,
                page: 1,
                kind: '!light_novel,!novel',
            });

            const ranobeBody = ranobeRequest.body as { variables: Record<string, unknown> };
            expect(ranobeBody.variables).toEqual({
                mylist: 'completed',
                limit: LIST_LIMIT,
                page: 2,
                kind: 'light_novel,novel',
            });
        });

        it('maps mylist manga items through mapMangaToRateRow', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(
                jsonResponse(200, { data: { mangas: [fullRawMylistManga] } }),
            );

            await expect(listRates('manga', 'watching', 1)).resolves.toEqual({
                items: [fullMangaRateRow],
                hasMore: false,
            });
        });

        it('anime mylist routes to animes() without a kind variable', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { animes: [] } }));

            await listRates('anime', 'watching', 1);

            const body = capturedRequests()[0].body as {
                query: string;
                variables: Record<string, unknown>;
            };
            expect(body.query).toContain('query MylistAnimes');
            expect(body.query).not.toContain('$kind');
            expect(body.variables).not.toHaveProperty('kind');
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

        it('routes manga and ranobe to SearchMangas with the kind filter', async () => {
            await setLocal('auth', storedAuth());
            fetchMock
                .mockResolvedValueOnce(jsonResponse(200, { data: { mangas: [] } }))
                .mockResolvedValueOnce(jsonResponse(200, { data: { mangas: [] } }));

            await expect(searchTitles('overlord', 'manga')).resolves.toEqual([]);
            await expect(searchTitles('overlord', 'ranobe', 2)).resolves.toEqual([]);

            const [mangaRequest, ranobeRequest] = capturedRequests();
            const mangaBody = mangaRequest.body as {
                query: string;
                variables: Record<string, unknown>;
            };
            expect(mangaBody.query).toContain('query SearchMangas');
            expect(mangaBody.query).toContain('$kind: MangaKindString');
            expect(mangaBody.query).toContain('volumes');
            expect(mangaBody.query).toContain('chapters');
            expect(mangaBody.variables).toEqual({
                search: 'overlord',
                limit: 10,
                page: 1,
                kind: '!light_novel,!novel',
            });

            const ranobeBody = ranobeRequest.body as { variables: Record<string, unknown> };
            expect(ranobeBody.variables).toEqual({
                search: 'overlord',
                limit: 10,
                page: 2,
                kind: 'light_novel,novel',
            });
        });

        it('maps a manga search response through mapMangaToTitleCard', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(
                jsonResponse(200, { data: { mangas: [fullRawManga] } }),
            );

            await expect(searchTitles('fullmetal', 'manga')).resolves.toEqual([fullMangaCard]);
        });

        it('anime search routes to animes() without a kind variable', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { animes: [] } }));

            await searchTitles('frieren', 'anime');

            const body = capturedRequests()[0].body as {
                query: string;
                variables: Record<string, unknown>;
            };
            expect(body.query).toContain('query SearchAnimes');
            expect(body.query).not.toContain('$kind');
            expect(body.variables).not.toHaveProperty('kind');
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

    describe('background rates.list handler', () => {
        it('responds with the mapped items and hasMore over messaging', async () => {
            background.main();
            await setLocal('auth', storedAuth());
            const rawPage = Array.from({ length: LIST_LIMIT }, (_, i) => mylistAnime(i + 1));
            fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { animes: rawPage } }));

            const response = await sendMessage('rates.list', {
                type: 'anime',
                status: 'watching',
                page: 1,
            });
            expect(response.ok).toBe(true);
            if (response.ok) {
                expect(response.data.items).toHaveLength(LIST_LIMIT);
                expect(response.data.items[0]).toEqual(mapAnimeToRateRow(rawPage[0]));
                expect(response.data.hasMore).toBe(true);
            }
        });

        it('keeps the ApiError kind of a list failure on the wire', async () => {
            background.main();
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(
                jsonResponse(200, { errors: [{ message: 'mylist is invalid' }] }),
            );

            const response = await sendMessage('rates.list', {
                type: 'anime',
                status: 'watching',
                page: 1,
            });
            expect(response).toEqual({
                ok: false,
                error: { kind: 'api', status: 200, message: 'mylist is invalid' },
            });
        });
    });
});
