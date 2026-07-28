import { apiRequest } from './http';
import type {
    ApiError,
    CalendarItem,
    RateRow,
    SearchType,
    TitleCard,
    UserRateStatus,
} from './types';

// GraphQL read layer (docs/03-shikimori-api.md). Reads travel as HTTP POST, so
// the 429-retry allowed for reads is opted in explicitly (docs/02, limiter).

// Verbatim from the docs/03 reference query (introspection 2026-07-23), except
// userRate is trimmed to the UserRateRef fields. $limit/$page must be declared
// as PositiveInt, NOT Int — the server rejects Int variables for them.
const SEARCH_ANIMES_QUERY = `
query SearchAnimes($search: String, $limit: PositiveInt, $page: PositiveInt) {
  animes(search: $search, limit: $limit, page: $page) {
    id
    malId
    name
    russian
    kind
    score
    status
    episodes
    episodesAired
    airedOn { year }
    poster { miniUrl mini2xUrl }
    userRate { id status }
    url
  }
}`;

// Verbatim from the docs/03 SearchMangas template (fields confirmed by the live
// request of 2026-07-23 and introspection of 2026-07-24), except userRate is
// trimmed to the UserRateRef fields — same as SEARCH_ANIMES_QUERY.
const SEARCH_MANGAS_QUERY = `
query SearchMangas($search: String, $limit: PositiveInt, $page: PositiveInt, $kind: MangaKindString) {
  mangas(search: $search, limit: $limit, page: $page, kind: $kind) {
    id
    name
    russian
    kind
    score
    status
    volumes
    chapters
    airedOn { year }
    poster { miniUrl mini2xUrl }
    userRate { id status }
    url
  }
}`;

const SEARCH_LIMIT = 10;

// Maps the UI type selector to the mangas() kind filter (docs/03, confirmed by
// live requests 2026-07-23/24): ranobe is a Manga subtype selected by kind, the
// manga tab excludes it with the negative filter. Anime routes to animes() and
// needs no kind.
export const SEARCH_TYPE_TO_KIND: Record<SearchType, string | undefined> = {
    anime: undefined,
    manga: '!light_novel,!novel',
    ranobe: 'light_novel,novel',
};

// "My lists" read (variant A, docs/03): same card fields as SEARCH_ANIMES_QUERY,
// but userRate is expanded to { id status episodes score } for the RateRow
// progress/score. Depth 3 (animes -> userRate/poster -> scalar), within max 5.
// order is intentionally NOT set: no value of OrderEnum is verified against the
// schema (CLAUDE.md rule 4), so page-boundary stability is a known minor risk of
// phase 3 (a title crossing a list on the site may shift between pages).
const MYLIST_ANIMES_QUERY = `
query MylistAnimes($mylist: MylistString, $limit: PositiveInt, $page: PositiveInt) {
  animes(mylist: $mylist, limit: $limit, page: $page) {
    id
    malId
    name
    russian
    kind
    score
    status
    episodes
    episodesAired
    airedOn { year }
    poster { miniUrl mini2xUrl }
    userRate { id status episodes score }
    url
  }
}`;

// Manga/ranobe counterpart of MYLIST_ANIMES_QUERY, trimmed to what
// mapMangaToRateRow consumes (the anime variant over-fetches malId/kind/score
// of the title — not copied here). kind separates the manga and ranobe tabs.
const MYLIST_MANGAS_QUERY = `
query MylistMangas($mylist: MylistString, $limit: PositiveInt, $page: PositiveInt, $kind: MangaKindString) {
  mangas(mylist: $mylist, limit: $limit, page: $page, kind: $kind) {
    id
    name
    russian
    chapters
    poster { miniUrl mini2xUrl }
    userRate { id status chapters score }
    url
  }
}`;

// Page size of "My lists"; background derives hasMore from a full page (docs/06).
export const LIST_LIMIT = 30;

// Ongoings calendar (US-9), the docs/03 reference query plus one field:
// `status` of the title, which the reference query omits — the defensive filter
// in mapAnimeToCalendarItem needs it. mylist/status stay inline literals, as in
// docs/03: they are the definition of this query, not something a caller varies.
// The three mylist statuses are an owner-verification result (docs/03,
// docs/06): the server `status: "ongoing"` drops announcements by itself, so
// «Запланировано» adds airing titles and no dateless rows.
const CALENDAR_ANIMES_QUERY = `
query CalendarAnimes($limit: PositiveInt, $page: PositiveInt) {
  animes(mylist: "watching,rewatching,planned", status: "ongoing", limit: $limit, page: $page) {
    id
    name
    russian
    status
    episodes
    episodesAired
    nextEpisodeAt
    poster { miniUrl mini2xUrl }
    userRate { id status episodes }
    url
  }
}`;

// Page size of the calendar. 50 is the hard ceiling of animes(): larger values
// are silently clamped, without an error (docs/03, live check 2026-07-28), so
// asking for more would only look like a short page.
export const CALENDAR_LIMIT = 50;

// Hard ceiling on the sequential paging below. 150 airing titles in one
// person's «Смотрю» is already unrealistic, and an unbounded loop over a server
// paging quirk would hammer the limiter (CLAUDE.md rule 2).
export const CALENDAR_MAX_PAGES = 3;

// The my-list statuses the calendar shows; mirrors the `mylist` literal of
// CALENDAR_ANIMES_QUERY — the two must be edited together.
const CALENDAR_MYLIST_STATUSES: readonly UserRateStatus[] = [
    'watching',
    'rewatching',
    'planned',
];

// Title status the calendar shows; mirrors the `status` literal of the query.
const CALENDAR_TITLE_STATUS = 'ongoing';

// Raw wire shape of an animes() item; nullability per the docs/03 introspection
// results (2026-07-23). GraphQL ID! serializes as a numeric string.
export interface RawAnime {
    id: string;
    malId: string | null;
    name: string;
    russian: string | null;
    kind: string | null;
    score: number | null;
    status: string | null;
    episodes: number;
    episodesAired: number;
    airedOn: { year: number | null } | null;
    poster: { miniUrl: string; mini2xUrl: string } | null;
    userRate: { id: string; status: UserRateStatus } | null;
    // Absolute title page url, always on the domain the response came from
    // (live check 2026-07-27: a request to shikimori.io answers with
    // https://shikimori.io/animes/...). Typed nullable — the field was verified
    // by value, not by introspection, so a missing url must stay survivable.
    url: string | null;
}

// Same item under MYLIST_ANIMES_QUERY: userRate carries progress + score.
export interface RawMylistAnime extends Omit<RawAnime, 'userRate'> {
    userRate: { id: string; status: UserRateStatus; episodes: number; score: number } | null;
}

// Raw wire shape of a mangas() search item (SEARCH_MANGAS_QUERY); nullability
// per the docs/03 introspection results (2026-07-24): chapters/volumes are
// Int!, status is nullable. GraphQL ID! serializes as a numeric string.
export interface RawManga {
    id: string;
    name: string;
    russian: string | null;
    kind: string | null;
    score: number | null;
    status: string | null;
    volumes: number;
    chapters: number;
    airedOn: { year: number | null } | null;
    poster: { miniUrl: string; mini2xUrl: string } | null;
    userRate: { id: string; status: UserRateStatus } | null;
    url: string | null; // see RawAnime.url (mangas answer .../mangas/2-berserk)
}

// Raw wire shape of a mangas(mylist:) item (MYLIST_MANGAS_QUERY): only the
// fields mapMangaToRateRow consumes; userRate carries progress + score.
export interface RawMylistManga {
    id: string;
    name: string;
    russian: string | null;
    chapters: number;
    poster: { miniUrl: string; mini2xUrl: string } | null;
    userRate: { id: string; status: UserRateStatus; chapters: number; score: number } | null;
    url: string | null; // see RawAnime.url
}

// Raw wire shape of a CALENDAR_ANIMES_QUERY item. nextEpisodeAt is
// ISO8601DateTime with an offset and nullable (docs/03, introspection
// 2026-07-28); userRate carries the episode progress, as in the mylist read.
export interface RawCalendarAnime {
    id: string;
    name: string;
    russian: string | null;
    status: string | null; // AnimeStatusEnum value; nullable, like everywhere else
    episodes: number;
    episodesAired: number;
    nextEpisodeAt: string | null;
    poster: { miniUrl: string; mini2xUrl: string } | null;
    userRate: { id: string; status: UserRateStatus; episodes: number } | null;
    url: string | null; // see RawAnime.url
}

// GraphQL transport envelope: HTTP 200 may still carry errors[] without data.
interface GraphqlResponse<T> {
    data?: T | null;
    errors?: { message?: string }[];
}

// Pure mapper, exported for tests. mapMangaToTitleCard is the manga/ranobe
// counterpart: chapters/volumes instead of episodes/episodesAired.
export function mapAnimeToTitleCard(raw: RawAnime): TitleCard {
    return {
        id: raw.id,
        targetType: 'Anime',
        name: raw.name,
        russian: raw.russian,
        kind: raw.kind,
        score: raw.score,
        status: raw.status,
        episodes: raw.episodes,
        episodesAired: raw.episodesAired,
        year: raw.airedOn?.year ?? null,
        posterUrl: raw.poster?.miniUrl ?? null,
        posterUrl2x: raw.poster?.mini2xUrl ?? null,
        userRate:
            raw.userRate === null ? null : { id: raw.userRate.id, status: raw.userRate.status },
        url: raw.url,
    };
}

// Pure mapper, exported for tests. Ranobe cards also carry targetType 'Manga':
// REST writes and the book wording do not distinguish the subtypes.
export function mapMangaToTitleCard(raw: RawManga): TitleCard {
    return {
        id: raw.id,
        targetType: 'Manga',
        name: raw.name,
        russian: raw.russian,
        kind: raw.kind,
        score: raw.score,
        status: raw.status,
        chapters: raw.chapters,
        volumes: raw.volumes,
        year: raw.airedOn?.year ?? null,
        posterUrl: raw.poster?.miniUrl ?? null,
        posterUrl2x: raw.poster?.mini2xUrl ?? null,
        userRate:
            raw.userRate === null ? null : { id: raw.userRate.id, status: raw.userRate.status },
        url: raw.url,
    };
}

export async function searchTitles(
    query: string,
    type: SearchType,
    page?: number,
): Promise<TitleCard[]> {
    if (type === 'anime') {
        const data = await graphqlRequest<{ animes: RawAnime[] }>(SEARCH_ANIMES_QUERY, {
            search: query,
            limit: SEARCH_LIMIT,
            page: page ?? 1,
        });
        return data.animes.map(mapAnimeToTitleCard);
    }
    const data = await graphqlRequest<{ mangas: RawManga[] }>(SEARCH_MANGAS_QUERY, {
        search: query,
        limit: SEARCH_LIMIT,
        page: page ?? 1,
        kind: SEARCH_TYPE_TO_KIND[type],
    });
    return data.mangas.map(mapMangaToTitleCard);
}

// Pure mapper, exported for tests. Returns null for a userRate-less item so the
// caller can drop it: mylist never returns such rows by contract, this is a
// guard. mapMangaToRateRow is the manga/ranobe counterpart (chapters progress).
export function mapAnimeToRateRow(raw: RawMylistAnime): RateRow | null {
    if (raw.userRate === null) {
        return null;
    }
    return {
        rateId: raw.userRate.id,
        targetId: raw.id,
        targetType: 'Anime',
        name: raw.name,
        russian: raw.russian,
        posterUrl: raw.poster?.miniUrl ?? null,
        posterUrl2x: raw.poster?.mini2xUrl ?? null,
        status: raw.userRate.status,
        score: raw.userRate.score,
        progress: raw.userRate.episodes,
        total: raw.episodes,
        url: raw.url,
    };
}

// Pure mapper, exported for tests; same userRate==null guard as the anime one.
// Progress unit is chapters (docs/03 status: increment-for-manga pending).
export function mapMangaToRateRow(raw: RawMylistManga): RateRow | null {
    if (raw.userRate === null) {
        return null;
    }
    return {
        rateId: raw.userRate.id,
        targetId: raw.id,
        targetType: 'Manga',
        name: raw.name,
        russian: raw.russian,
        posterUrl: raw.poster?.miniUrl ?? null,
        posterUrl2x: raw.poster?.mini2xUrl ?? null,
        status: raw.userRate.status,
        score: raw.userRate.score,
        progress: raw.userRate.chapters,
        total: raw.chapters,
        url: raw.url,
    };
}

export async function listRates(
    type: SearchType,
    status: UserRateStatus,
    page: number,
): Promise<{ items: RateRow[]; hasMore: boolean }> {
    // hasMore is derived from the RAW page length, before the userRate==null
    // filter: a full page with a dropped row would otherwise cut paging short
    // and lose titles.
    if (type === 'anime') {
        const data = await graphqlRequest<{ animes: RawMylistAnime[] }>(MYLIST_ANIMES_QUERY, {
            mylist: status,
            limit: LIST_LIMIT,
            page,
        });
        const hasMore = data.animes.length === LIST_LIMIT;
        const items = data.animes
            .map(mapAnimeToRateRow)
            .filter((row): row is RateRow => row !== null);
        return { items, hasMore };
    }
    const data = await graphqlRequest<{ mangas: RawMylistManga[] }>(MYLIST_MANGAS_QUERY, {
        mylist: status,
        limit: LIST_LIMIT,
        page,
        kind: SEARCH_TYPE_TO_KIND[type],
    });
    const hasMore = data.mangas.length === LIST_LIMIT;
    const items = data.mangas.map(mapMangaToRateRow).filter((row): row is RateRow => row !== null);
    return { items, hasMore };
}

// Pure mapper, exported for tests. Returns null for a row the calendar must not
// show, so the caller can simply drop it. Two reasons to drop:
//
// 1. userRate === null — the same guard as the mylist mappers: a row that is
//    not mine has no progress to show.
// 2. The defensive filter: it repeats client-side what the `mylist` + `status`
//    arguments already do server-side. Owner-verification of 2026-07-28 (docs/03,
//    checkbox «Комбинация `mylist` + `status` под Bearer…») showed the server
//    honours both — the filter is insurance, not a workaround, and costs one
//    comparison per row. That checkbox is still only PARTLY closed (a real row
//    with nextEpisodeAt under Bearer has not been observed yet), and a released
//    title leaking into the calendar would be a silent wrong answer.
//
// `status: null` is NOT a reason to drop, only an explicitly foreign value is
// (`released`, `anons`). Anime.status is nullable by introspection (docs/03), and
// a missing row is just as wrong as a leaked released one but harder to spot — an
// absent line on screen is invisible, so nobody reports it. The server-side
// `status: "ongoing"` filter is confirmed, so a row that came back at all is
// trusted when it says nothing about its own status.
export function mapAnimeToCalendarItem(raw: RawCalendarAnime): CalendarItem | null {
    if (raw.userRate === null) {
        return null;
    }
    const foreignTitleStatus = raw.status !== null && raw.status !== CALENDAR_TITLE_STATUS;
    if (foreignTitleStatus || !CALENDAR_MYLIST_STATUSES.includes(raw.userRate.status)) {
        return null;
    }
    return {
        rateId: raw.userRate.id,
        targetId: raw.id,
        name: raw.name,
        russian: raw.russian,
        status: raw.userRate.status,
        posterUrl: raw.poster?.miniUrl ?? null,
        posterUrl2x: raw.poster?.mini2xUrl ?? null,
        // Raw ISO through to the UI layer: only calendar-schedule.ts parses it.
        nextEpisodeAt: raw.nextEpisodeAt,
        episodes: raw.episodes,
        episodesAired: raw.episodesAired,
        progress: raw.userRate.episodes,
        url: raw.url,
    };
}

// Reads the whole calendar: the UI has no «Ещё» button, so paging is done here.
// Sequential on purpose — a parallel fan-out over pages would burst the rate
// limiter (CLAUDE.md rule 2); in practice page 2 is never even requested.
export async function listCalendar(): Promise<CalendarItem[]> {
    const items: CalendarItem[] = [];
    for (let page = 1; page <= CALENDAR_MAX_PAGES; page += 1) {
        const data = await graphqlRequest<{ animes: RawCalendarAnime[] }>(CALENDAR_ANIMES_QUERY, {
            limit: CALENDAR_LIMIT,
            page,
        });
        for (const raw of data.animes) {
            const item = mapAnimeToCalendarItem(raw);
            if (item !== null) {
                items.push(item);
            }
        }
        // "Keep going while the page came back full", measured on the RAW page
        // length, before the filter: a page where one row was dropped would
        // otherwise cut paging short and lose titles (same rule as listRates).
        if (data.animes.length < CALENDAR_LIMIT) {
            break;
        }
    }
    return items;
}

async function graphqlRequest<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const result = await apiRequest<GraphqlResponse<T>>('/api/graphql', {
        method: 'POST',
        body: { query, variables },
        // Explicit opt-in: GraphQL is a read despite being a POST, so the
        // GET-only 429-retry default of http.ts does not cover it (docs/02).
        retryOn429: true,
    });
    if (!result.ok) {
        throw result.error;
    }
    return unwrapGraphqlResponse(result.data);
}

function unwrapGraphqlResponse<T>(response: GraphqlResponse<T>): T {
    const errors = response.errors;
    if (errors !== undefined && errors.length > 0) {
        // GraphQL reports failures as 200 + errors[]; surfaced with the 'api'
        // kind so the UI shows the server message (docs/02 error model).
        throw {
            kind: 'api',
            status: 200,
            message: errors[0].message ?? 'GraphQL error',
        } satisfies ApiError;
    }
    if (response.data === undefined || response.data === null) {
        throw { kind: 'internal', message: 'GraphQL response has no data' } satisfies ApiError;
    }
    return response.data;
}
