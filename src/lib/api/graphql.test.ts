import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import background from '@/entrypoints/background';
import { sendMessage } from '../messaging';
import { setLocal } from '../storage';
import type { LocalState } from '../storage';
import {
    LIST_LIMIT,
    ONGOING_LIMIT,
    ONGOING_MAX_PAGES,
    SEARCH_TYPE_TO_KIND,
    listCalendar,
    listRates,
    listRelated,
    mapAnimeToAiredPollItem,
    mapAnimeToCalendarItem,
    mapAnimeToRateRow,
    mapAnimeToTitleCard,
    mapMangaToRateRow,
    mapMangaToTitleCard,
    mapRelatedToItem,
    pollAiredAnimes,
    searchTitles,
} from './graphql';
import type {
    RawAnime,
    RawCalendarAnime,
    RawManga,
    RawMylistAnime,
    RawMylistManga,
    RawPollAnime,
    RawRelated,
    RawRelatedAnime,
} from './graphql';
import { RANOBE_KINDS } from '../title-card';
import { buildSchedule, countTitlesBehind } from '../calendar-schedule';
import type { BacklogItem, ScheduleItem } from '../calendar-schedule';
import { diffAired } from '../aired-snapshot';
import type { AiredObservation } from '../aired-snapshot';
import { displayTitle } from '../title-name';
import type { TitleNames } from '../title-name';
import { ensureToken } from './auth';
import { rateLimiter, setTokenProvider } from './http';
import type {
    AiredPollItem,
    ApiError,
    CalendarItem,
    RateRow,
    TitleCard,
    User,
    UserRateStatus,
} from './types';

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

// Realistic calendar wire fixture (Ф7-5): shape from the docs/03 reference
// query, values from the live request of 2026-07-28 — episodes: 0 (unknown
// total) and a date with an offset, i.e. an instant rather than a wall date.
const fullRawCalendarAnime: RawCalendarAnime = {
    id: '21',
    name: 'One Piece',
    russian: 'Ван-Пис',
    status: 'ongoing',
    episodes: 0,
    episodesAired: 1147,
    nextEpisodeAt: '2026-08-02T17:15:00+03:00',
    poster: {
        miniUrl: 'https://desu.shikimori.one/uploads/poster/animes/21/mini.webp',
        mini2xUrl: 'https://desu.shikimori.one/uploads/poster/animes/21/mini@2x.webp',
    },
    userRate: { id: '777', status: 'watching', episodes: 1140 },
    url: 'https://shikimori.io/animes/21-one-piece',
};

const fullCalendarItem: CalendarItem = {
    rateId: '777',
    targetId: '21',
    name: 'One Piece',
    russian: 'Ван-Пис',
    status: 'watching',
    posterUrl: 'https://desu.shikimori.one/uploads/poster/animes/21/mini.webp',
    posterUrl2x: 'https://desu.shikimori.one/uploads/poster/animes/21/mini@2x.webp',
    nextEpisodeAt: '2026-08-02T17:15:00+03:00',
    episodes: 0,
    episodesAired: 1147,
    progress: 1140,
    url: 'https://shikimori.io/animes/21-one-piece',
};

// Compact calendar item generator for page-size fixtures.
function calendarAnime(id: number, overrides: Partial<RawCalendarAnime> = {}): RawCalendarAnime {
    return {
        ...fullRawCalendarAnime,
        id: String(id),
        name: `Ongoing ${id}`,
        userRate: { id: String(2000 + id), status: 'watching', episodes: 3 },
        ...overrides,
    };
}

// The same title as read by POLL_AIRED_ANIMES_QUERY (Ф11-8): the counter, the
// progress, the rate id a write from the popup comes back with (Ф11-9) and the
// name pair the notification says out loud — no presentation data.
const fullRawPollAnime: RawPollAnime = {
    id: '21',
    name: 'One Piece',
    russian: 'Ван-Пис',
    episodesAired: 1147,
    url: 'https://shikimori.io/animes/21-one-piece',
    userRate: { id: '2021', episodes: 1140 },
};

const fullPollItem: AiredPollItem = {
    targetId: '21',
    rateId: '2021',
    name: 'One Piece',
    russian: 'Ван-Пис',
    episodesAired: 1147,
    progress: 1140,
    url: 'https://shikimori.io/animes/21-one-piece',
};

// Compact poll item generator for page-size fixtures.
function pollAnime(id: number, overrides: Partial<RawPollAnime> = {}): RawPollAnime {
    return {
        ...fullRawPollAnime,
        id: String(id),
        name: `Ongoing ${id}`,
        userRate: { id: String(2000 + id), episodes: 3 },
        ...overrides,
    };
}

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

// The anime half of a Related element (Ф12-5): shape from the docs/03 reference
// query, i.e. the search card MINUS malId — that field is not asked for there.
// Values are the ones of fullRawAnime on purpose, so the expected result of the
// mapper is fullTitleCard and no second expected card has to be kept in step.
const relatedAnimeHalf: RawRelatedAnime = {
    id: '52991',
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
    url: 'https://shikimori.io/animes/52991-sousou-no-frieren',
};

// One Related element per media half — the server fills exactly one of the two.
// relationText is the server's own Russian and the two fixtures word different
// kinds on purpose: anime and manga phrase the SAME relationKind differently
// (docs/03), which is why it stays row meta instead of becoming a heading.
const relatedAnimeItem: RawRelated = {
    relationKind: 'sequel',
    relationText: 'Сиквел',
    anime: relatedAnimeHalf,
    manga: null,
};

const relatedMangaItem: RawRelated = {
    relationKind: 'adaptation',
    relationText: 'Первоисточник',
    anime: null,
    manga: fullRawManga,
};

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

    describe('mapAnimeToCalendarItem', () => {
        it('maps a full calendar row 1:1', () => {
            expect(mapAnimeToCalendarItem(fullRawCalendarAnime)).toEqual(fullCalendarItem);
        });

        it('returns null for an item without userRate (dropped by the caller)', () => {
            expect(mapAnimeToCalendarItem({ ...fullRawCalendarAnime, userRate: null })).toBeNull();
        });

        it('keeps russian: null (the UI falls back to the romaji name)', () => {
            const item = mapAnimeToCalendarItem({ ...fullRawCalendarAnime, russian: null });
            expect(item?.russian).toBeNull();
            expect(item?.name).toBe('One Piece');
        });

        it('maps a missing poster to null poster urls', () => {
            const item = mapAnimeToCalendarItem({ ...fullRawCalendarAnime, poster: null });
            expect(item?.posterUrl).toBeNull();
            expect(item?.posterUrl2x).toBeNull();
        });

        it('carries the url of the title through, null included (Ф6-26)', () => {
            expect(mapAnimeToCalendarItem(fullRawCalendarAnime)?.url).toBe(
                'https://shikimori.io/animes/21-one-piece',
            );
            expect(mapAnimeToCalendarItem({ ...fullRawCalendarAnime, url: null })?.url).toBeNull();
        });

        // The raw string is the contract with the schedule layer: formatting it
        // here would make the session cache go stale by the clock (Ф7-5).
        it('keeps nextEpisodeAt as the raw ISO string, offset included', () => {
            expect(mapAnimeToCalendarItem(fullRawCalendarAnime)?.nextEpisodeAt).toBe(
                '2026-08-02T17:15:00+03:00',
            );
        });

        it('keeps a null nextEpisodeAt (the ~8% of ongoings without a date)', () => {
            const item = mapAnimeToCalendarItem({
                ...fullRawCalendarAnime,
                nextEpisodeAt: null,
            });
            expect(item?.nextEpisodeAt).toBeNull();
        });

        it('takes progress from userRate.episodes and the total from the title', () => {
            const item = mapAnimeToCalendarItem({
                ...fullRawCalendarAnime,
                episodes: 24,
                episodesAired: 12,
                userRate: { id: '9', status: 'rewatching', episodes: 7 },
            });
            expect(item).toMatchObject({
                progress: 7,
                episodes: 24,
                episodesAired: 12,
                status: 'rewatching',
            });
        });

        // Defensive filter: the server arguments are confirmed (docs/03,
        // owner-verification 2026-07-28), this is the insurance layer.
        describe('defensive client-side filter', () => {
            it('drops a title whose status is explicitly something else', () => {
                for (const status of ['released', 'anons']) {
                    expect(mapAnimeToCalendarItem({ ...fullRawCalendarAnime, status })).toBeNull();
                }
            });

            // Ф7-14: Anime.status is nullable (docs/03), and a row that vanishes
            // from the calendar is invisible — the guard only fires on a value
            // that is explicitly not ongoing, never on a missing one.
            it('keeps a row with status: null instead of losing it', () => {
                const item = mapAnimeToCalendarItem({ ...fullRawCalendarAnime, status: null });
                expect(item).toEqual(fullCalendarItem);
            });

            it('keeps the three calendar list statuses', () => {
                const kept: UserRateStatus[] = ['watching', 'rewatching', 'planned'];
                for (const status of kept) {
                    const item = mapAnimeToCalendarItem({
                        ...fullRawCalendarAnime,
                        userRate: { id: '777', status, episodes: 1140 },
                    });
                    expect(item?.status).toBe(status);
                }
            });

            it('drops the other list statuses', () => {
                const dropped: UserRateStatus[] = ['completed', 'on_hold', 'dropped'];
                for (const status of dropped) {
                    expect(
                        mapAnimeToCalendarItem({
                            ...fullRawCalendarAnime,
                            userRate: { id: '777', status, episodes: 1140 },
                        }),
                    ).toBeNull();
                }
            });
        });
    });

    describe('mapRelatedToItem', () => {
        it('maps the anime half and keeps the server relation text', () => {
            expect(mapRelatedToItem(relatedAnimeItem)).toEqual({
                relationKind: 'sequel',
                relationText: 'Сиквел',
                card: fullTitleCard,
            });
        });

        it('maps the manga half through the manga card mapper', () => {
            expect(mapRelatedToItem(relatedMangaItem)).toEqual({
                relationKind: 'adaptation',
                relationText: 'Первоисточник',
                card: fullMangaCard,
            });
        });

        // Both halves empty contradicts the server contract; the row is dropped
        // rather than drawn as a relation label with no title under it.
        it('drops an element with both halves empty', () => {
            expect(mapRelatedToItem({ ...relatedAnimeItem, anime: null })).toBeNull();
        });

        // RelationKind is our snapshot of a server enum: a value added to it
        // later must cost the row nothing.
        it('normalizes an unknown relation kind to other, keeping its text', () => {
            expect(
                mapRelatedToItem({
                    ...relatedAnimeItem,
                    relationKind: 'crossover',
                    relationText: 'Кроссовер',
                }),
            ).toEqual({ relationKind: 'other', relationText: 'Кроссовер', card: fullTitleCard });
        });

        // 18+ titles come back without a poster in GraphQL (docs/06 smoke list).
        it('keeps a card that has no poster', () => {
            const item = mapRelatedToItem({
                ...relatedAnimeItem,
                anime: { ...relatedAnimeHalf, poster: null },
            });
            expect(item?.card.posterUrl).toBeNull();
            expect(item?.card.posterUrl2x).toBeNull();
        });

        it('maps a missing airedOn to year: null', () => {
            const item = mapRelatedToItem({
                ...relatedAnimeItem,
                anime: { ...relatedAnimeHalf, airedOn: null },
            });
            expect(item?.card.year).toBeNull();
        });

        // A ranobe among the relations is the case the poster split hangs on:
        // targetType is 'Manga' for it (REST writes do not know the subtypes),
        // so `kind` is the ONLY thing that later routes it to the ranobe index
        // (posterTypeOf, src/lib/title-card.ts) instead of /api/mangas, which drops
        // light novels silently.
        it('keeps the kind of a ranobe half, which is what routes its poster', () => {
            const item = mapRelatedToItem({
                ...relatedMangaItem,
                manga: { ...fullRawManga, kind: 'light_novel' },
            });
            expect(item?.card.targetType).toBe('Manga');
            expect(item?.card.kind).toBe('light_novel');
        });

        // Both halves filled contradicts the contract just as both empty does,
        // but here there IS something to draw. Pinned rather than left to the
        // reading order of an if-chain: a silent switch to the manga half would
        // change the id space of the row, and with it its dedup key.
        it('prefers the anime half if the server ever fills both', () => {
            expect(mapRelatedToItem({ ...relatedAnimeItem, manga: fullRawManga })?.card).toEqual(
                fullTitleCard,
            );
        });

        // Ф12-1 is about the OTHER value: under Bearer a title from my lists is
        // expected to carry a userRate here. A null one must keep meaning "not
        // in my lists" — the row is drawn without a badge, never dropped.
        it('carries a null userRate as a card without one', () => {
            const item = mapRelatedToItem({
                ...relatedAnimeItem,
                anime: { ...relatedAnimeHalf, userRate: null },
            });
            expect(item?.card.userRate).toBeNull();
            expect(item?.card.id).toBe('52991');
        });

        // Related.id identifies the LINK and is volatile between requests: it
        // must not reach a RelatedItem, or the screen may start keying rows on it.
        it('carries exactly relationKind, relationText and card', () => {
            expect(Object.keys(mapRelatedToItem(relatedAnimeItem) ?? {}).sort()).toEqual([
                'card',
                'relationKind',
                'relationText',
            ]);
        });
    });

    // Poster urls end up in an <img src>, so they pass the same https guard as
    // an outbound link: a refused url is mapped to null, and the component then
    // draws the local fallback image (`posterUrl || posterFallback`) instead of
    // an <img> with a broken src.
    describe('poster https guard', () => {
        // One scheme that would run code in the page, one plain downgrade.
        const refusedPoster = {
            miniUrl: 'javascript:alert(1)',
            mini2xUrl: 'http://desu.shikimori.one/uploads/poster/animes/52991/mini@2x.webp',
        };

        it('drops both urls of an anime card', () => {
            const card = mapAnimeToTitleCard({ ...fullRawAnime, poster: refusedPoster });
            expect(card.posterUrl).toBeNull();
            expect(card.posterUrl2x).toBeNull();
        });

        it('drops both urls of a manga card', () => {
            const card = mapMangaToTitleCard({ ...fullRawManga, poster: refusedPoster });
            expect(card.posterUrl).toBeNull();
            expect(card.posterUrl2x).toBeNull();
        });

        it('drops both urls of a mylist row', () => {
            const rows = [
                mapAnimeToRateRow({ ...fullRawMylistAnime, poster: refusedPoster }),
                mapMangaToRateRow({ ...fullRawMylistManga, poster: refusedPoster }),
            ];
            for (const row of rows) {
                expect(row?.posterUrl).toBeNull();
                expect(row?.posterUrl2x).toBeNull();
            }
        });

        it('drops both urls of a calendar row', () => {
            const item = mapAnimeToCalendarItem({
                ...fullRawCalendarAnime,
                poster: refusedPoster,
            });
            expect(item?.posterUrl).toBeNull();
            expect(item?.posterUrl2x).toBeNull();
        });

        // The 1x url is a complete poster on its own — only the srcset pair is
        // lost, so a refused retina url must not cost the visible image.
        it('keeps the 1x url when only the retina one is refused', () => {
            const card = mapAnimeToTitleCard({
                ...fullRawAnime,
                poster: {
                    miniUrl: 'https://desu.shikimori.one/uploads/poster/animes/52991/mini.webp',
                    mini2xUrl: '//evil.test/mini@2x.webp',
                },
            });
            expect(card.posterUrl).toBe(
                'https://desu.shikimori.one/uploads/poster/animes/52991/mini.webp',
            );
            expect(card.posterUrl2x).toBeNull();
        });
    });

    // CalendarItem must stay assignable to ScheduleItem: the schedule layer is
    // generic over it, so a renamed field would otherwise surface only in the
    // UI. The assignment below is the actual check (pnpm compile covers the
    // test files); the buildSchedule call proves it end to end.
    describe('CalendarItem satisfies ScheduleItem', () => {
        it('is accepted by buildSchedule and handed back by reference', () => {
            const scheduleItem: ScheduleItem = fullCalendarItem;
            expect(scheduleItem.nextEpisodeAt).toBe(fullCalendarItem.nextEpisodeAt);

            // Local parts, then ISO: the expectation holds in any timezone.
            const item = mapAnimeToCalendarItem({
                ...fullRawCalendarAnime,
                nextEpisodeAt: new Date(2026, 7, 2, 17, 15).toISOString(),
                episodes: 12,
                episodesAired: 4,
                userRate: { id: '777', status: 'watching', episodes: 2 },
            });
            expect(item).not.toBeNull();

            const days = buildSchedule([item as CalendarItem], new Date(2026, 7, 2, 12, 0));
            expect(days).toHaveLength(1);
            expect(days[0].label).toBe('Сегодня');
            expect(days[0].entries[0].item).toBe(item);
            expect(days[0].entries[0].episode).toBe(5); // episodesAired + 1
            expect(days[0].entries[0].episodesTotal).toBe(12);
            expect(days[0].entries[0].behind).toBe(2); // aired 4, watched 2
        });
    });

    describe('listCalendar', () => {
        it('POSTs CalendarAnimes with the reference-query arguments and maps the rows', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(
                jsonResponse(200, { data: { animes: [fullRawCalendarAnime] } }),
            );

            await expect(listCalendar()).resolves.toEqual([fullCalendarItem]);

            const request = capturedRequests()[0];
            expect(request.url).toBe('https://shikimori.io/api/graphql');
            expect(request.method).toBe('POST');

            const body = request.body as { query: string; variables: Record<string, unknown> };
            expect(body.variables).toEqual({ limit: ONGOING_LIMIT, page: 1 });
            // 50 is the hard ceiling of animes(): above it the server clamps
            // silently, so a bigger page size would look like a short page.
            expect(ONGOING_LIMIT).toBe(50);
            expect(body.query).toContain('query CalendarAnimes');
            // mylist/status are inline literals of the query, not variables.
            expect(body.query).toContain(
                'animes(mylist: "watching,rewatching,planned", status: "ongoing", limit: $limit, page: $page)',
            );
            // PositiveInt, not Int: the server rejects Int variables (docs/03).
            expect(body.query).toContain('$limit: PositiveInt');
            expect(body.query).toContain('$page: PositiveInt');
            expect(body.query).toContain('nextEpisodeAt');
            expect(body.query).toContain('poster { miniUrl mini2xUrl }');
            expect(body.query).toContain('userRate { id status episodes }');
            // Its own field line: `status` of the title feeds the client guard,
            // and a plain substring check would also match userRate { … status }.
            expect(body.query).toMatch(/^\s+status$/m);
            expect(body.query).toMatch(/^\s+url$/m);
        });

        it('stops after one request when the first page is short', async () => {
            await setLocal('auth', storedAuth());
            const page = Array.from({ length: ONGOING_LIMIT - 1 }, (_, i) => calendarAnime(i + 1));
            fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { animes: page } }));

            await expect(listCalendar()).resolves.toHaveLength(ONGOING_LIMIT - 1);
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it('asks for the next page while the previous one came back full', async () => {
            await setLocal('auth', storedAuth());
            const fullPage = Array.from({ length: ONGOING_LIMIT }, (_, i) => calendarAnime(i + 1));
            fetchMock
                .mockResolvedValueOnce(jsonResponse(200, { data: { animes: fullPage } }))
                .mockResolvedValueOnce(
                    jsonResponse(200, { data: { animes: [calendarAnime(999)] } }),
                );

            const items = await listCalendar();
            expect(items).toHaveLength(ONGOING_LIMIT + 1);
            expect(items[ONGOING_LIMIT].targetId).toBe('999');
            expect(fetchMock).toHaveBeenCalledTimes(2);
            expect(
                capturedRequests().map(
                    (request) => (request.body as { variables: { page: number } }).variables.page,
                ),
            ).toEqual([1, 2]);
        });

        it('never goes past the hard page ceiling, even on full pages', async () => {
            await setLocal('auth', storedAuth());
            const fullPage = Array.from({ length: ONGOING_LIMIT }, (_, i) => calendarAnime(i + 1));
            // A fresh Response per call: a body can only be consumed once.
            fetchMock.mockImplementation(async () =>
                jsonResponse(200, { data: { animes: fullPage } }),
            );

            const items = await listCalendar();
            expect(ONGOING_MAX_PAGES).toBe(3);
            expect(fetchMock).toHaveBeenCalledTimes(ONGOING_MAX_PAGES);
            expect(items).toHaveLength(ONGOING_LIMIT * ONGOING_MAX_PAGES);
        });

        it('keeps paging by the RAW page length, before the filter drops rows', async () => {
            await setLocal('auth', storedAuth());
            // A full page where half the rows are filtered out: paging must
            // continue, or the titles on page 2 would be lost.
            const fullPage = Array.from({ length: ONGOING_LIMIT }, (_, i) =>
                i % 2 === 0 ? calendarAnime(i + 1, { status: 'released' }) : calendarAnime(i + 1),
            );
            fetchMock
                .mockResolvedValueOnce(jsonResponse(200, { data: { animes: fullPage } }))
                .mockResolvedValueOnce(jsonResponse(200, { data: { animes: [] } }));

            await expect(listCalendar()).resolves.toHaveLength(ONGOING_LIMIT / 2);
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });

        it('drops released titles and foreign list statuses from the response', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(
                jsonResponse(200, {
                    data: {
                        animes: [
                            fullRawCalendarAnime,
                            calendarAnime(2, { status: 'released' }),
                            calendarAnime(3, {
                                userRate: { id: '3', status: 'completed', episodes: 12 },
                            }),
                            calendarAnime(4, { userRate: null }),
                            calendarAnime(5, {
                                userRate: { id: '5', status: 'planned', episodes: 0 },
                            }),
                            // Nullable field, so a row that says nothing about its
                            // own status stays in (Ф7-14).
                            calendarAnime(6, { status: null }),
                        ],
                    },
                }),
            );

            const items = await listCalendar();
            expect(items.map((item) => item.targetId)).toEqual(['21', '5', '6']);
        });

        it('returns an empty list for an empty first page without a second request', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { animes: [] } }));

            await expect(listCalendar()).resolves.toEqual([]);
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });
    });

    describe('mapAnimeToAiredPollItem', () => {
        it('maps a full poll row 1:1', () => {
            expect(mapAnimeToAiredPollItem(fullRawPollAnime)).toEqual(fullPollItem);
        });

        // mylist never returns rows without a rate by contract; a row that has
        // none carries no progress, and counting it as "watched nothing" would
        // put a title that is not in my lists on the badge.
        it('drops a row without a userRate', () => {
            expect(mapAnimeToAiredPollItem({ ...fullRawPollAnime, userRate: null })).toBeNull();
        });

        // Ф11-16. The address a click on the notification opens is the one the
        // answer carried — never one built here from origin + id (Ф6-26), so a
        // profile switched to .one gets .one addresses without any code knowing.
        it('carries the title page url through untouched', () => {
            expect(mapAnimeToAiredPollItem(fullRawPollAnime)?.url).toBe(
                'https://shikimori.io/animes/21-one-piece',
            );
            expect(
                mapAnimeToAiredPollItem({
                    ...fullRawPollAnime,
                    url: 'https://shikimori.one/animes/21-one-piece',
                })?.url,
            ).toBe('https://shikimori.one/animes/21-one-piece');
        });

        // Typed nullable defensively (RawAnime.url): a row without an address is
        // still a row the badge counts, it just has nowhere to click to.
        it('keeps a missing url as null instead of dropping the row', () => {
            expect(mapAnimeToAiredPollItem({ ...fullRawPollAnime, url: null })).toEqual({
                ...fullPollItem,
                url: null,
            });
        });

        // A long-runner just added to «Запланировано»: zero progress is a real
        // value, not a missing one, and it must survive as 0 — the whole aired
        // count is the backlog then.
        it('keeps a zero progress as zero', () => {
            const item = mapAnimeToAiredPollItem({
                ...fullRawPollAnime,
                userRate: { id: '2021', episodes: 0 },
            });
            expect(item?.progress).toBe(0);
            expect(countTitlesBehind([item as BacklogItem])).toBe(1);
        });

        // Nothing aired yet is not a backlog either — both numbers are 0.
        it('maps a title with nothing aired yet without a backlog', () => {
            const item = mapAnimeToAiredPollItem({
                ...fullRawPollAnime,
                episodesAired: 0,
                userRate: { id: '2021', episodes: 0 },
            });
            expect(countTitlesBehind([item as BacklogItem])).toBe(0);
        });

        // The name pair is why the poll asks for two fields the reference query
        // did not (Ф11-10): the notification names the title by `titleLang`, and
        // without it the message would have to say the id out loud.
        it('carries the name pair for the notification text', () => {
            const item = mapAnimeToAiredPollItem(fullRawPollAnime);
            expect(displayTitle(item as AiredPollItem, 'ru').primary).toBe('Ван-Пис');
            expect(displayTitle(item as AiredPollItem, 'romaji').primary).toBe('One Piece');
        });

        // `russian` is nullable in the schema, and displayTitle already falls
        // back to the romaji name — so a title without one is a notification
        // with a name, not a notification with a hole.
        it('carries a null russian through', () => {
            const item = mapAnimeToAiredPollItem({ ...fullRawPollAnime, russian: null });
            expect(item).toEqual({ ...fullPollItem, russian: null });
            expect(displayTitle(item as AiredPollItem, 'ru').primary).toBe('One Piece');
        });

        // The row is handed to three pure modules untouched: the badge counter
        // (BacklogItem), the snapshot diff (AiredObservation) and the title
        // naming (TitleNames). All three are structural, so a renamed field
        // would surface only in the background.
        it('satisfies BacklogItem, AiredObservation and TitleNames', () => {
            const backlog: BacklogItem = fullPollItem;
            const observation: AiredObservation = fullPollItem;
            const names: TitleNames = fullPollItem;
            expect(countTitlesBehind([backlog])).toBe(1); // 1147 aired, 1140 watched
            expect(diffAired({ '21': 1146 }, [observation]).increases).toEqual([
                { targetId: '21', from: 1146, to: 1147 },
            ]);
            expect(displayTitle(names, 'ru')).toEqual({
                primary: 'Ван-Пис',
                secondary: 'One Piece',
            });
        });
    });

    describe('pollAiredAnimes', () => {
        it('POSTs PollAiredAnimes with the reference-query fields and maps the rows', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(
                jsonResponse(200, { data: { animes: [fullRawPollAnime] } }),
            );

            await expect(pollAiredAnimes()).resolves.toEqual([fullPollItem]);

            const request = capturedRequests()[0];
            expect(request.url).toBe('https://shikimori.io/api/graphql');
            expect(request.method).toBe('POST');

            const body = request.body as { query: string; variables: Record<string, unknown> };
            expect(body.variables).toEqual({ limit: ONGOING_LIMIT, page: 1 });
            expect(body.query).toContain('query PollAiredAnimes');
            expect(body.query).toContain(
                'animes(mylist: "watching,rewatching,planned", status: "ongoing", limit: $limit, page: $page)',
            );
            // PositiveInt, not Int: the server rejects Int variables (docs/03).
            expect(body.query).toContain('$limit: PositiveInt');
            expect(body.query).toContain('$page: PositiveInt');
            // The rate id came back in Ф11-9 and is read by the badge: a write
            // from the popup answers with it and with nothing else, and that is
            // what lets «+1 эпизод» move the counter without a second request.
            expect(body.query).toContain('userRate { id episodes }');
            expect(body.query).toMatch(/^\s+id$/m);
            expect(body.query).toMatch(/^\s+name$/m);
            expect(body.query).toMatch(/^\s+russian$/m);
            expect(body.query).toMatch(/^\s+episodesAired$/m);
            // Ф11-16: where a click on the notification goes. Asked for and NOT
            // assembled from the origin setting plus the id — Ф6-26, the domain
            // has moved four times and the answer carries the current one.
            expect(body.query).toMatch(/^\s+url$/m);
        });

        // The whole point of a second query: 12,7 КБ per 50 rows against 25,2 КБ
        // of the calendar form (замер 2026-08-17, docs/03). A field nobody reads
        // costs weight on every background tick — the Ф12-5 precedent. Both
        // additions to the first redaction of the reference query are read: the
        // name pair by the notification text, `url` by the click on it.
        it('asks for nothing the badge and the notification do not read', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { animes: [] } }));

            await pollAiredAnimes();

            const query = (capturedRequests()[0].body as { query: string }).query;
            for (const field of ['poster', 'malId', 'score']) {
                expect(query).not.toContain(field);
            }
            // Nor the air date: it was asked for until the audit before 1.2.0 and
            // read by nobody — the notification text is built from episode
            // numbers alone, and planning by date is ruled out anyway (docs/03).
            expect(query).not.toContain('nextEpisodeAt');
            // The episode TOTAL: `episodesAired` and `userRate { episodes }` are
            // asked for, a field line of its own is not.
            expect(query).not.toMatch(/^\s+episodes$/m);
            // Nor the title's own status — unlike the calendar, this read draws
            // no row, so it needs no defensive filter (the filter literal in the
            // arguments is a different thing).
            expect(query).not.toMatch(/^\s+status$/m);
            // The user_rate id IS asked for since Ф11-9 — and it is read, which
            // is the whole rule: it identifies the row a write from the popup
            // belongs to (src/lib/badge.ts). Nothing beyond the pair is taken:
            // the rate's status and score would be dead weight on every tick.
            expect(query).not.toMatch(/userRate \{[^}]*(status|score)/);
        });

        // Both reads describe the SAME server list, and drifting apart would
        // mean the calendar and the notifications talk about different titles
        // (docs/03). Built from one constant, so this is a pin, not a hope.
        it('filters the list exactly like the calendar query does', async () => {
            await setLocal('auth', storedAuth());
            // A fresh Response per call: a body can only be consumed once.
            fetchMock.mockImplementation(async () => jsonResponse(200, { data: { animes: [] } }));

            await listCalendar();
            await pollAiredAnimes();

            const [calendar, poll] = capturedRequests().map(
                (request) => (request.body as { query: string }).query,
            );
            const filter = /animes\((mylist: [^)]*?status: "[a-z]+")/;
            expect(poll.match(filter)?.[1]).toBe(calendar.match(filter)?.[1]);
        });

        it('stops after one request when the first page is short', async () => {
            await setLocal('auth', storedAuth());
            const page = Array.from({ length: ONGOING_LIMIT - 1 }, (_, i) => pollAnime(i + 1));
            fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { animes: page } }));

            await expect(pollAiredAnimes()).resolves.toHaveLength(ONGOING_LIMIT - 1);
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it('asks for the next page while the previous one came back full', async () => {
            await setLocal('auth', storedAuth());
            const fullPage = Array.from({ length: ONGOING_LIMIT }, (_, i) => pollAnime(i + 1));
            fetchMock
                .mockResolvedValueOnce(jsonResponse(200, { data: { animes: fullPage } }))
                .mockResolvedValueOnce(jsonResponse(200, { data: { animes: [pollAnime(999)] } }));

            const items = await pollAiredAnimes();
            expect(items).toHaveLength(ONGOING_LIMIT + 1);
            expect(items[ONGOING_LIMIT].targetId).toBe('999');
            expect(
                capturedRequests().map(
                    (request) => (request.body as { variables: { page: number } }).variables.page,
                ),
            ).toEqual([1, 2]);
        });

        it('never goes past the hard page ceiling, even on full pages', async () => {
            await setLocal('auth', storedAuth());
            const fullPage = Array.from({ length: ONGOING_LIMIT }, (_, i) => pollAnime(i + 1));
            fetchMock.mockImplementation(async () =>
                jsonResponse(200, { data: { animes: fullPage } }),
            );

            const items = await pollAiredAnimes();
            expect(fetchMock).toHaveBeenCalledTimes(ONGOING_MAX_PAGES);
            expect(items).toHaveLength(ONGOING_LIMIT * ONGOING_MAX_PAGES);
        });

        it('keeps paging by the RAW page length, before the filter drops rows', async () => {
            await setLocal('auth', storedAuth());
            const fullPage = Array.from({ length: ONGOING_LIMIT }, (_, i) =>
                i % 2 === 0 ? pollAnime(i + 1, { userRate: null }) : pollAnime(i + 1),
            );
            fetchMock
                .mockResolvedValueOnce(jsonResponse(200, { data: { animes: fullPage } }))
                .mockResolvedValueOnce(jsonResponse(200, { data: { animes: [] } }));

            await expect(pollAiredAnimes()).resolves.toHaveLength(ONGOING_LIMIT / 2);
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });

        it('returns an empty list for an empty first page without a second request', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { animes: [] } }));

            await expect(pollAiredAnimes()).resolves.toEqual([]);
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        // An unauthorized poll must fail as an ApiError, not as a thrown
        // TypeError: the background tick decides what to do with it (Ф11-7).
        it('fails with unauthorized when there is no auth', async () => {
            const error = await expectApiErrorThrow(pollAiredAnimes());
            expect(error).toEqual({ kind: 'unauthorized' });
            expect(fetchMock).not.toHaveBeenCalled();
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
            expect(Object.keys(SEARCH_TYPE_TO_KIND).sort()).toEqual(['anime', 'manga', 'ranobe']);
            expect(SEARCH_TYPE_TO_KIND.anime).toBeUndefined();
            expect(SEARCH_TYPE_TO_KIND.manga).toBe('!light_novel,!novel');
            expect(SEARCH_TYPE_TO_KIND.ranobe).toBe('light_novel,novel');
        });

        // The filter is built from RANOBE_KINDS, and the poster split reads the
        // same list (posterTypeOf, src/lib/title-card.ts). This pins the tie: a
        // kind added there must show up in both halves of the filter, or the
        // search tab and the poster index would disagree about what a ranobe is.
        it('covers every RANOBE_KINDS value in both halves of the filter', () => {
            for (const kind of RANOBE_KINDS) {
                expect(SEARCH_TYPE_TO_KIND.ranobe?.split(',')).toContain(kind);
                expect(SEARCH_TYPE_TO_KIND.manga?.split(',')).toContain(`!${kind}`);
            }
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

    describe('listRelated', () => {
        it('POSTs RelatedAnimes with the ids variable and maps both media', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(
                jsonResponse(200, {
                    data: { animes: [{ related: [relatedAnimeItem, relatedMangaItem] }] },
                }),
            );

            await expect(listRelated('5114', 'Anime')).resolves.toEqual([
                { relationKind: 'sequel', relationText: 'Сиквел', card: fullTitleCard },
                { relationKind: 'adaptation', relationText: 'Первоисточник', card: fullMangaCard },
            ]);
            // One screen — one GraphQL request (DoD of phase 12).
            expect(fetchMock).toHaveBeenCalledTimes(1);

            const request = capturedRequests()[0];
            expect(request.url).toBe('https://shikimori.io/api/graphql');
            expect(request.method).toBe('POST');
            // Ф12-1: userRate inside related can only be non-null if the read
            // goes out authorized.
            expect(request.headers['Authorization']).toBe('Bearer stored-access');

            const body = request.body as { query: string; variables: Record<string, unknown> };
            expect(body.variables).toEqual({ ids: '5114' });
            expect(body.query).toContain('query RelatedAnimes');
            expect(body.query).toContain('animes(ids: $ids, limit: 1)');
            // Both media in one request (docs/06, owner decision 4).
            expect(body.query).toContain('anime { id name russian');
            expect(body.query).toContain('manga { id name russian');
        });

        it('routes a Manga target to RelatedMangas without a kind filter', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(
                jsonResponse(200, { data: { mangas: [{ related: [relatedAnimeItem] }] } }),
            );

            await expect(listRelated('25', 'Manga')).resolves.toEqual([
                { relationKind: 'sequel', relationText: 'Сиквел', card: fullTitleCard },
            ]);

            const body = capturedRequests()[0].body as {
                query: string;
                variables: Record<string, unknown>;
            };
            expect(body.query).toContain('query RelatedMangas');
            expect(body.query).toContain('mangas(ids: $ids, limit: 1)');
            // Ranobe hosts go through the same query: ids names one title.
            expect(body.query).not.toContain('$kind');
            expect(body.variables).toEqual({ ids: '25' });
        });

        // Pins the TEXT of both queries, not their cost: complexity is counted
        // only by the server (Ф12-11), and `related` + `chronology` in one
        // request is refused at 207 of the undeclared 190 (docs/03).
        it('asks for no chronology and nests no deeper than airedOn { year }', async () => {
            await setLocal('auth', storedAuth());
            fetchMock
                .mockResolvedValueOnce(jsonResponse(200, { data: { animes: [] } }))
                .mockResolvedValueOnce(jsonResponse(200, { data: { mangas: [] } }));

            await listRelated('5114', 'Anime');
            await listRelated('25', 'Manga');

            const queries = capturedRequests().map(
                (request) => (request.body as { query: string }).query,
            );
            expect(queries).toHaveLength(2);
            for (const query of queries) {
                expect(query).not.toContain('chronology');
                expect(query).toContain('airedOn { year }');
                // Depth 5 is the floor of the query: year has no selection set.
                expect(query).not.toContain('year {');
                // Nothing unread is paid for against the ceiling: the entry
                // control is not gated on `franchise` (Ф12-8), the host itself
                // is never shown, and Related.id identifies a volatile link.
                expect(query).not.toContain('franchise');
                expect(query).toContain('limit: 1) {\n    related {');
                expect(query).toContain('related {\n      relationKind relationText');
            }
        });

        it('reports a title without relations as an empty list', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(
                jsonResponse(200, { data: { animes: [{ related: [] }] } }),
            );

            await expect(listRelated('199', 'Anime')).resolves.toEqual([]);
        });

        // `[Related!]` is a nullable list, and a null one says the same thing as
        // an empty one — no relations, not a failure.
        it('treats related: null as no relations', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(
                jsonResponse(200, { data: { animes: [{ related: null }] } }),
            );

            await expect(listRelated('578', 'Anime')).resolves.toEqual([]);
        });

        // ids is a filter: an id nobody knows answers with an empty list at 200.
        it('treats an answer without a host title as no relations', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { animes: [] } }));

            await expect(listRelated('999999999', 'Anime')).resolves.toEqual([]);
        });

        it('drops an element with both halves empty and keeps its neighbours', async () => {
            await setLocal('auth', storedAuth());
            const broken: RawRelated = {
                relationKind: 'other',
                relationText: 'Прочее',
                anime: null,
                manga: null,
            };
            fetchMock.mockResolvedValueOnce(
                jsonResponse(200, {
                    data: { animes: [{ related: [broken, relatedAnimeItem, broken] }] },
                }),
            );

            const items = await listRelated('5114', 'Anime');
            expect(items).toHaveLength(1);
            expect(items[0].card).toEqual(fullTitleCard);
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

    describe('background calendar.list handler', () => {
        it('responds with the whole list, paging done inside background', async () => {
            background.main();
            await setLocal('auth', storedAuth());
            const fullPage = Array.from({ length: ONGOING_LIMIT }, (_, i) => calendarAnime(i + 1));
            fetchMock
                .mockResolvedValueOnce(jsonResponse(200, { data: { animes: fullPage } }))
                .mockResolvedValueOnce(
                    jsonResponse(200, { data: { animes: [fullRawCalendarAnime] } }),
                );

            const response = await sendMessage('calendar.list');
            expect(response.ok).toBe(true);
            if (response.ok) {
                // Two pages behind one message: the popup knows nothing about them.
                expect(response.data.items).toHaveLength(ONGOING_LIMIT + 1);
                expect(response.data.items[ONGOING_LIMIT]).toEqual(fullCalendarItem);
            }
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });

        it('keeps the ApiError kind of a calendar failure on the wire', async () => {
            background.main();
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(
                jsonResponse(200, { errors: [{ message: 'mylist is invalid' }] }),
            );

            const response = await sendMessage('calendar.list');
            expect(response).toEqual({
                ok: false,
                error: { kind: 'api', status: 200, message: 'mylist is invalid' },
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

    describe('background titles.related handler', () => {
        it('responds with the flat mapped list over messaging', async () => {
            background.main();
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(
                jsonResponse(200, {
                    data: { animes: [{ related: [relatedAnimeItem, relatedMangaItem] }] },
                }),
            );

            const response = await sendMessage('titles.related', {
                targetId: '5114',
                targetType: 'Anime',
            });
            // Background reshapes nothing: grouping and ordering are the UI's
            // (src/lib/related.ts), so the wire carries the server order as is.
            expect(response).toEqual({
                ok: true,
                data: {
                    items: [
                        { relationKind: 'sequel', relationText: 'Сиквел', card: fullTitleCard },
                        {
                            relationKind: 'adaptation',
                            relationText: 'Первоисточник',
                            card: fullMangaCard,
                        },
                    ],
                },
            });
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        // The distinction the screen lives on: no relations is a state with its
        // own text, not a failure — it must never arrive as { ok: false }.
        it('answers ok with an empty list for a title without relations', async () => {
            background.main();
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(
                jsonResponse(200, { data: { animes: [{ related: [] }] } }),
            );

            const response = await sendMessage('titles.related', {
                targetId: '199',
                targetType: 'Anime',
            });
            expect(response).toEqual({ ok: true, data: { items: [] } });
        });

        // The complexity ceiling is undeclared and counted only by the server,
        // so this refusal is what a query grown one field too big looks like at
        // runtime: HTTP 200 + errors[]. It must reach the UI as an error with
        // the 'api' kind — that kind is what Ф12-9 replaces with Russian text,
        // instead of showing the user «Query has complexity of…» verbatim.
        it('keeps the ApiError kind of a complexity refusal on the wire', async () => {
            background.main();
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(
                jsonResponse(200, {
                    errors: [
                        {
                            message:
                                'Query has complexity of 207, which exceeds max complexity of 190',
                        },
                    ],
                }),
            );

            const response = await sendMessage('titles.related', {
                targetId: '21',
                targetType: 'Anime',
            });
            expect(response).toEqual({
                ok: false,
                error: {
                    kind: 'api',
                    status: 200,
                    message: 'Query has complexity of 207, which exceeds max complexity of 190',
                },
            });
        });
    });
});
