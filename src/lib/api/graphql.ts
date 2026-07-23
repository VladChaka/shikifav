import { apiRequest } from './http';
import type { ApiError, RateRow, SearchType, TitleCard, UserRateStatus } from './types';

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
  }
}`;

const SEARCH_LIMIT = 10;

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
  }
}`;

// Page size of "My lists"; background derives hasMore from a full page (docs/06).
export const LIST_LIMIT = 30;

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
}

// Same item under MYLIST_ANIMES_QUERY: userRate carries progress + score.
export interface RawMylistAnime extends Omit<RawAnime, 'userRate'> {
    userRate: { id: string; status: UserRateStatus; episodes: number; score: number } | null;
}

// GraphQL transport envelope: HTTP 200 may still carry errors[] without data.
interface GraphqlResponse<T> {
    data?: T | null;
    errors?: { message?: string }[];
}

// Pure mapper, exported for tests. The manga/ranobe counterpart (phase 4)
// fills chapters/volumes instead of episodes/episodesAired.
export function mapAnimeToTitleCard(raw: RawAnime): TitleCard {
    return {
        id: raw.id,
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
    };
}

export async function searchTitles(
    query: string,
    type: SearchType,
    page?: number,
): Promise<TitleCard[]> {
    if (type !== 'anime') {
        // Manga/ranobe search (SearchMangas + kind filter) is phase 4; the
        // signature and the card shape are already final.
        throw {
            kind: 'internal',
            message: `Search type "${type}" is not implemented`,
        } satisfies ApiError;
    }
    const data = await graphqlRequest<{ animes: RawAnime[] }>(SEARCH_ANIMES_QUERY, {
        search: query,
        limit: SEARCH_LIMIT,
        page: page ?? 1,
    });
    return data.animes.map(mapAnimeToTitleCard);
}

// Pure mapper, exported for tests. Returns null for a userRate-less item so the
// caller can drop it: mylist never returns such rows by contract, this is a
// guard. The manga/ranobe counterpart (phase 4) fills chapters/volumes instead.
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
    };
}

export async function listAnimeRates(
    type: SearchType,
    status: UserRateStatus,
    page: number,
): Promise<{ items: RateRow[]; hasMore: boolean }> {
    if (type !== 'anime') {
        // Manga/ranobe lists are phase 4; the signature and RateRow shape are
        // already final (same reasoning as searchTitles).
        throw {
            kind: 'internal',
            message: `List type "${type}" is not implemented`,
        } satisfies ApiError;
    }
    const data = await graphqlRequest<{ animes: RawMylistAnime[] }>(MYLIST_ANIMES_QUERY, {
        mylist: status,
        limit: LIST_LIMIT,
        page,
    });
    // hasMore is derived from the RAW page length, before the userRate==null
    // filter: a full page with a dropped row would otherwise cut paging short
    // and lose titles.
    const hasMore = data.animes.length === LIST_LIMIT;
    const items = data.animes.map(mapAnimeToRateRow).filter((row): row is RateRow => row !== null);
    return { items, hasMore };
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
