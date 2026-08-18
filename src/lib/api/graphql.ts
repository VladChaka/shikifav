import { httpsHref } from '../external-url';
import { normalizeRelationKind } from '../related';
import { RANOBE_KINDS } from '../title-card';
import { apiRequest } from './http';
import type {
    AiredPollItem,
    ApiError,
    CalendarItem,
    RateRow,
    RateTargetType,
    RelatedItem,
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
//
// Built from RANOBE_KINDS rather than spelled out ('light_novel,novel'): the
// same list decides which REST index a poster is asked from (posterTypeOf,
// src/lib/title-card.ts). Two copies would drift, and a ranobe sent to
// /api/mangas?ids= is dropped there without an error (docs/03) — a missing
// poster and nothing in the console.
export const SEARCH_TYPE_TO_KIND: Record<SearchType, string | undefined> = {
    anime: undefined,
    manga: RANOBE_KINDS.map((kind) => `!${kind}`).join(','),
    ranobe: RANOBE_KINDS.join(','),
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

// The my-list statuses of every "my ongoings" read. An owner-verification
// result (docs/03, docs/06): the server `status: "ongoing"` drops announcements
// by itself, so «Запланировано» adds airing titles and no dateless rows.
// Exported since Ф11-9: the badge keeps rows of exactly this set between ticks,
// so a write that moves a title out of it («Просмотрено», «Брошено») has to drop
// the row — and the only correct definition of "out of it" is this constant.
export const ONGOING_MYLIST_STATUSES: readonly UserRateStatus[] = [
    'watching',
    'rewatching',
    'planned',
];

// Title status of every "my ongoings" read.
const ONGOING_TITLE_STATUS = 'ongoing';

// The animes() filter shared by the calendar read and the background airing
// poll, built from the constants above instead of being spelled out twice.
// Two queries ask about the same list for two different screens, and drifting
// apart would mean the calendar and the notifications talk about different
// titles (docs/03, «Опрос — эталонный запрос»). Interpolation into query text is
// safe here and nowhere else: both values are our own constants, never input.
const ONGOING_ANIMES_FILTER = `mylist: "${ONGOING_MYLIST_STATUSES.join(',')}", status: "${ONGOING_TITLE_STATUS}"`;

// Ongoings calendar (US-9), the docs/03 reference query plus one field:
// `status` of the title, which the reference query omits — the defensive filter
// in mapAnimeToCalendarItem needs it. mylist/status stay inline (through the
// shared filter above) and are NOT variables, as in docs/03: they are the
// definition of this query, not something a caller varies.
const CALENDAR_ANIMES_QUERY = `
query CalendarAnimes($limit: PositiveInt, $page: PositiveInt) {
  animes(${ONGOING_ANIMES_FILTER}, limit: $limit, page: $page) {
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

// Airing poll (US-12, phase 11): the docs/03 reference query plus the name pair
// and `url`. The narrow field set is the point of a separate query — 12,7 КБ per
// 50 rows against 25,2 КБ of the calendar form (measurement 2026-08-17), and
// this one runs in the background every 30 minutes. Nothing may be added to it
// that the badge or the notification does not read (the Ф12-5 precedent).
//
// `name`/`russian` are the single addition to the reference query, and they ARE
// read: the notification must name the title in the language of the `titleLang`
// setting (US-12, Ф11-10), and that pair is exactly what displayTitle takes.
// The alternative was a second request for the titles that actually moved: it
// saves ~5 КБ on every quiet tick, but buys that with a request in the one
// moment a notification has to be shown quickly, and with a "notification
// without a title name" path when that request fails. Carrying the pair every
// tick is the cheaper failure mode.
//
// `nextEpisodeAt` is asked for despite planning NOT being based on it (a third
// of the ongoings have no date at all, docs/03): it is data for the message, not
// a schedule. `userRate { episodes }` is the progress the badge counts against.
// The title's own `status` is not asked for — unlike the calendar this read has
// no row to draw, so a leaked released title would only fail to move its counter.
//
// `userRate { id }` came back in Ф11-9 and is read, unlike in the redaction Ф11-8
// dropped it from: the badge has to react to a write made from the popup (US-12,
// «счётчик гаснет по мере отметок прогресса»), and a write answers with the rate
// id and nothing else (RateState). Without it the counter would only catch up on
// the next tick, i.e. up to half an hour later, or would cost an extra request
// per «+1». ~10 B per row under Bearer (docs/03).
//
// `url` is the click target of the notification (Ф11-16). It is asked for rather
// than assembled from the origin setting and the id, because assembling it is
// exactly what Ф6-26 forbids: the domain has moved four times (org → one → me →
// io) and the answer already carries the one it came from. Measured cost on 50
// public rows, same ids in both runs (2026-08-17): 9 547 B → 13 028 B.
const POLL_AIRED_ANIMES_QUERY = `
query PollAiredAnimes($limit: PositiveInt, $page: PositiveInt) {
  animes(${ONGOING_ANIMES_FILTER}, limit: $limit, page: $page) {
    id
    name
    russian
    episodesAired
    nextEpisodeAt
    url
    userRate { id episodes }
  }
}`;

// Page size of both "my ongoings" reads. 50 is the hard ceiling of animes():
// larger values are silently clamped, without an error (docs/03, live check
// 2026-07-28), so asking for more would only look like a short page.
//
// Named after the list and not after the calendar screen (Ф11-8): the background
// poll pages by the very same constants, so a "let the calendar load fewer
// rows" edit under the old name would have silently changed what the tick reads.
export const ONGOING_LIMIT = 50;

// Hard ceiling on the sequential paging below. 150 airing titles in one
// person's «Смотрю» is already unrealistic, and an unbounded loop over a server
// paging quirk would hammer the limiter (CLAUDE.md rule 2). Shared with the
// poll: it reads the very same list, only with fewer fields.
export const ONGOING_MAX_PAGES = 3;

// Related titles (US-11): the docs/03 reference query as measured live on
// 2026-08-10 (One Piece, 92 relations), minus three fields nobody reads (see
// below) — a strict subset, so the measurement still holds. TWO server ceilings
// meet in this text, and both are counted by the server, never here:
//
// 1. `max complexity 190` — undeclared, absent from /api/doc/graphql, reachable
//    only by being refused. This selection fits; adding `chronology` to it costs
//    207, and even asking `chronology` for two scalars costs 210 — so not one
//    field may be added below. A refusal arrives as HTTP 200 + errors[], i.e. as
//    a broken screen at runtime, and no test can catch it (Ф12-11).
// 2. `max depth 5` — `animes -> related -> anime -> airedOn -> year` is exactly
//    five, so nothing nested below `year` can ever be requested here.
//
// `limit: 1` is an inline literal, like the calendar's mylist/status: it is part
// of the definition of this query (`ids` names one title), not a caller's knob.
// Nothing above `related` is asked for: the docs/03 reference query also carried
// the host's `id` and `franchise` and the link's own `Related.id`, and all three
// are read by nobody — `Related.id` identifies the LINK and is volatile, while
// the entry control is deliberately NOT gated on `franchise` (docs/06, Ф12-8: 2
// titles out of the top 100 carry a null slug with a non-empty `related`). Every
// field is charged against the ceiling, and `Related.id` was charged 92 times on
// One Piece, so what is unread is not asked for.
const RELATED_ANIMES_QUERY = `
query RelatedAnimes($ids: String) {
  animes(ids: $ids, limit: 1) {
    related {
      relationKind relationText
      anime { id name russian kind score status episodes episodesAired airedOn { year } poster { miniUrl mini2xUrl } userRate { id status } url }
      manga { id name russian kind score status volumes chapters airedOn { year } poster { miniUrl mini2xUrl } userRate { id status } url }
    }
  }
}`;

// Mirror of RELATED_ANIMES_QUERY for a Manga host — same Related selection, only
// the root differs. No `kind` filter: `ids` already names exactly one title, and
// ranobe is read through the same mangas() root (docs/03), so ranobe hosts need
// no separate query.
const RELATED_MANGAS_QUERY = `
query RelatedMangas($ids: String) {
  mangas(ids: $ids, limit: 1) {
    related {
      relationKind relationText
      anime { id name russian kind score status episodes episodesAired airedOn { year } poster { miniUrl mini2xUrl } userRate { id status } url }
      manga { id name russian kind score status volumes chapters airedOn { year } poster { miniUrl mini2xUrl } userRate { id status } url }
    }
  }
}`;

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

// Raw wire shape of a POLL_AIRED_ANIMES_QUERY item (Ф11-8). No presentation
// data beyond the name pair the notification says out loud: the poll answers
// "did the counter move" and "what to call the title", never "what to draw".
// Nullability follows the same introspection as the calendar row — `russian`,
// `nextEpisodeAt`, `url` and `userRate` are the nullable ones here.
export interface RawPollAnime {
    id: string;
    name: string;
    russian: string | null;
    episodesAired: number;
    nextEpisodeAt: string | null;
    url: string | null; // see RawAnime.url — Ф11-16, where the click goes
    userRate: { id: string; episodes: number } | null;
}

// The anime half of a Related element: the search card minus `malId`, which the
// reference query does not ask for — nothing on the related screen shows it, and
// every field is charged against the complexity ceiling. Derived with Omit
// rather than spelled out a second time: two literal copies of the same twelve
// fields would drift apart on the first change to the card.
export type RawRelatedAnime = Omit<RawAnime, 'malId'>;

// One element of Anime.related / Manga.related (docs/03, introspection
// 2026-08-10). Exactly one of anime/manga is filled and the other is null — a
// mixed list of both media is the point of asking for both halves (docs/06,
// decision 4: «аниме ↔ первоисточник» without a second request).
//
// `Related.id` is neither typed here nor asked for: it identifies the LINK, is
// volatile between requests and is unusable as a key or a cache identity. Card
// identity on this screen is the pair (targetType, id) — cardKey, title-card.ts.
//
// `relationKind` is typed as string, not RelationKind: the union is our snapshot
// of a server enum that may grow without warning, so the value becomes a
// RelationKind only through normalizeRelationKind (src/lib/related.ts).
export interface RawRelated {
    relationKind: string;
    relationText: string;
    anime: RawRelatedAnime | null;
    // The manga half needs no trimming: the reference query asks for exactly the
    // RawManga field set, ranobe included (same shape, different kind).
    manga: RawManga | null;
}

// The host title of a related read. animes(ids:)/mangas(ids:) answer with a LIST
// of one, and `related` is `[Related!]` — the list itself is nullable, its
// elements are not. One field, because the query asks for one: the host is a
// route to its relations here, nothing on the screen shows the host itself.
export interface RawRelatedHost {
    related: RawRelated[] | null;
}

// GraphQL transport envelope: HTTP 200 may still carry errors[] without data.
interface GraphqlResponse<T> {
    data?: T | null;
    errors?: { message?: string }[];
}

// Poster urls of every mapper below pass the same https guard as an outbound
// link (src/lib/external-url.ts): they are server data that also survives in the
// session cache, and they end up in an <img src>. A refused url becomes null —
// the "no poster" state the cards already draw with the local fallback image.

// Pure mapper, exported for tests. mapMangaToTitleCard is the manga/ranobe
// counterpart: chapters/volumes instead of episodes/episodesAired.
//
// Typed by the NARROWER related shape (RawAnime is assignable to it): the mapper
// never reads malId, so the related read reuses it as is instead of carrying a
// second card mapper that would have to be kept in step with this one.
export function mapAnimeToTitleCard(raw: RawRelatedAnime): TitleCard {
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
        posterUrl: httpsHref(raw.poster?.miniUrl),
        posterUrl2x: httpsHref(raw.poster?.mini2xUrl),
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
        posterUrl: httpsHref(raw.poster?.miniUrl),
        posterUrl2x: httpsHref(raw.poster?.mini2xUrl),
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
        posterUrl: httpsHref(raw.poster?.miniUrl),
        posterUrl2x: httpsHref(raw.poster?.mini2xUrl),
        status: raw.userRate.status,
        score: raw.userRate.score,
        progress: raw.userRate.episodes,
        total: raw.episodes,
        url: raw.url,
    };
}

// Pure mapper, exported for tests; same userRate==null guard as the anime one.
// Progress unit is chapters — confirmed by the owner smoke of 2026-07-27
// (docs/03, checkbox «`increment` для манги»).
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
        posterUrl: httpsHref(raw.poster?.miniUrl),
        posterUrl2x: httpsHref(raw.poster?.mini2xUrl),
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
    const foreignTitleStatus = raw.status !== null && raw.status !== ONGOING_TITLE_STATUS;
    if (foreignTitleStatus || !ONGOING_MYLIST_STATUSES.includes(raw.userRate.status)) {
        return null;
    }
    return {
        rateId: raw.userRate.id,
        targetId: raw.id,
        name: raw.name,
        russian: raw.russian,
        status: raw.userRate.status,
        posterUrl: httpsHref(raw.poster?.miniUrl),
        posterUrl2x: httpsHref(raw.poster?.mini2xUrl),
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
    for (let page = 1; page <= ONGOING_MAX_PAGES; page += 1) {
        const data = await graphqlRequest<{ animes: RawCalendarAnime[] }>(CALENDAR_ANIMES_QUERY, {
            limit: ONGOING_LIMIT,
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
        if (data.animes.length < ONGOING_LIMIT) {
            break;
        }
    }
    return items;
}

// Pure mapper, exported for tests. Returns null for a row the poll cannot use,
// so the caller can simply drop it — the same contract as the calendar mapper.
// The only such row is one without a `userRate`: `mylist` never returns those by
// contract, and without my progress there is no backlog to count. Treating a
// missing rate as "watched nothing" would put a title I do not have in my lists
// on the badge.
//
// No defensive status filter here, unlike the calendar: this query asks neither
// for the title's status nor for mine (docs/03, «Опрос — эталонный запрос»), and
// a leaked foreign row costs nothing anyway — its counter simply stops moving.
export function mapAnimeToAiredPollItem(raw: RawPollAnime): AiredPollItem | null {
    if (raw.userRate === null) {
        return null;
    }
    return {
        targetId: raw.id,
        rateId: raw.userRate.id,
        name: raw.name,
        russian: raw.russian,
        episodesAired: raw.episodesAired,
        // Raw ISO through, exactly as with the calendar row: this layer never
        // parses dates.
        nextEpisodeAt: raw.nextEpisodeAt,
        progress: raw.userRate.episodes,
        // Passed through untouched, like every other url of this file: the https
        // guard of the cards would not be enough here anyway — a click on a
        // notification is opened by us, so the host is checked as well, right
        // before the tab (src/lib/external-url.ts, shikimoriHref).
        url: raw.url,
    };
}

// Reads the whole "my ongoings" list in the narrow poll form. Paging, ceilings
// and the "keep going while the page came back full" rule are the calendar's,
// verbatim and on the same constants — it is the same server list (docs/03).
// Sequential on purpose: a parallel fan-out over pages would burst the rate
// limiter (CLAUDE.md rule 2); in practice page 2 is never even requested.
export async function pollAiredAnimes(): Promise<AiredPollItem[]> {
    const items: AiredPollItem[] = [];
    for (let page = 1; page <= ONGOING_MAX_PAGES; page += 1) {
        const data = await graphqlRequest<{ animes: RawPollAnime[] }>(POLL_AIRED_ANIMES_QUERY, {
            limit: ONGOING_LIMIT,
            page,
        });
        for (const raw of data.animes) {
            const item = mapAnimeToAiredPollItem(raw);
            if (item !== null) {
                items.push(item);
            }
        }
        // Measured on the RAW page length, before the filter: a page where one
        // row was dropped would otherwise cut paging short and lose titles.
        if (data.animes.length < ONGOING_LIMIT) {
            break;
        }
    }
    return items;
}

// Pure mapper, exported for tests. Returns null for an element the screen has
// nothing to draw — the same "let the caller drop it" contract as
// mapAnimeToCalendarItem. The only such element is one where BOTH halves are
// empty: the server fills exactly one of anime/manga per element by contract
// (docs/03), and a row without a title would render as an empty line carrying
// only a relation label.
export function mapRelatedToItem(raw: RawRelated): RelatedItem | null {
    const card = mapRelatedCard(raw);
    if (card === null) {
        return null;
    }
    return {
        // The server's enum value is narrowed here rather than trusted: an
        // unfamiliar kind lands in `other` instead of costing us the row
        // (src/lib/related.ts), and its Russian relationText still names it.
        relationKind: normalizeRelationKind(raw.relationKind),
        relationText: raw.relationText,
        card,
    };
}

function mapRelatedCard(raw: RawRelated): TitleCard | null {
    if (raw.anime !== null) {
        return mapAnimeToTitleCard(raw.anime);
    }
    if (raw.manga !== null) {
        return mapMangaToTitleCard(raw.manga);
    }
    return null;
}

// The whole related screen in ONE GraphQL request (docs/06, DoD of phase 12).
// The list is handed over flat and in server order — grouping, dedup and sorting
// live in src/lib/related.ts, so nothing here decides how the screen reads.
//
// ASSUMPTION (Ф12-1, owner-verification pending): `userRate` inside `related`
// comes back non-null under Bearer for a title that is in my lists. A public
// request answers null for every element and cannot tell "not in my lists" from
// "the field does not work nested". If it turns out to be the latter, the status
// badge needs a second request and this signature grows a follow-up read.
export async function listRelated(
    targetId: string,
    targetType: RateTargetType,
): Promise<RelatedItem[]> {
    if (targetType === 'Anime') {
        const data = await graphqlRequest<{ animes: RawRelatedHost[] }>(RELATED_ANIMES_QUERY, {
            ids: targetId,
        });
        return mapRelatedHosts(data.animes);
    }
    // Ranobe cards carry targetType 'Manga' (TitleCard), and mangas(ids:) answers
    // for them without a kind filter — the id names one title already.
    const data = await graphqlRequest<{ mangas: RawRelatedHost[] }>(RELATED_MANGAS_QUERY, {
        ids: targetId,
    });
    return mapRelatedHosts(data.mangas);
}

// `ids` is a FILTER, not a lookup: an id nobody knows answers with an empty list
// at HTTP 200, not with an error. So an absent host and `related: null` mean the
// same thing as `related: []` — "no relations", which is a normal state with its
// own text on the screen (docs/03: titles without relations are ordinary), not a
// failure to report.
function mapRelatedHosts(hosts: readonly RawRelatedHost[]): RelatedItem[] {
    const host = hosts[0];
    if (host === undefined || host.related === null) {
        return [];
    }
    return host.related.map(mapRelatedToItem).filter((item): item is RelatedItem => item !== null);
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
