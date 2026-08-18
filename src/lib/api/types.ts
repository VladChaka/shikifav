// Shared API types used across background, messaging and UI (docs/02-architecture.md).

export type ApiError =
    | { kind: 'network' } // fetch failed / timeout
    | { kind: 'unauthorized' } // 401 after a refresh attempt
    | { kind: 'rate_limited'; retryAfterMs?: number }
    | { kind: 'api'; status: number; message: string } // 4xx/5xx, including 422
    | { kind: 'internal'; message: string };

// Tied to ApiError so a renamed/removed kind fails compile here instead of
// silently making isApiError reject it (degrading real errors to 'internal').
const API_ERROR_KINDS = [
    'network',
    'unauthorized',
    'rate_limited',
    'api',
    'internal',
] as const satisfies readonly ApiError['kind'][];

// ApiError values travel as thrown plain objects between layers (token
// provider -> http, handlers -> messaging), so a structural guard is needed.
export function isApiError(value: unknown): value is ApiError {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const kind = (value as { kind?: unknown }).kind;
    return typeof kind === 'string' && (API_ERROR_KINDS as readonly string[]).includes(kind);
}

export interface User {
    id: number;
    nickname: string;
    avatarUrl: string;
}

// Popup-facing auth state. MUST NOT ever carry tokens: only background touches
// them, UI contexts receive { status, user } and nothing else (docs/04-auth.md §6).
export interface AuthState {
    status: 'anonymous' | 'authorized';
    user?: User;
}

// GraphQL UserRateStatusEnum = REST v2 statuses 1:1 (docs/03, introspection 2026-07-23).
export type UserRateStatus =
    | 'planned'
    | 'watching'
    | 'rewatching'
    | 'completed'
    | 'on_hold'
    | 'dropped';

// UI-level title kind selector (docs/02 protocol); 'ranobe' maps to the GraphQL
// mangas query with kind: "light_novel,novel" (docs/03).
export type SearchType = 'anime' | 'manga' | 'ranobe';

export type RateTargetType = 'Anime' | 'Manga';

// Minimal server rate snapshot: enough for a search card badge and as the
// response of write operations.
export interface UserRateRef {
    id: string;
    status: UserRateStatus;
}

// Server snapshot after a write (update/increment). Media-agnostic mirror of the
// REST user_rate; the UI picks the relevant progress field by targetType.
export interface RateState {
    id: string;
    status: UserRateStatus;
    score: number; // 0 = no score
    episodes: number; // anime progress
    chapters: number; // manga/ranobe progress (phase 4)
    volumes: number; // manga/ranobe (phase 4)
}

// A row of "My lists" (US-4): a title joined with my user_rate, read via
// animes(mylist:) / mangas(mylist:) (variant A).
export interface RateRow {
    rateId: string; // user_rate id — PATCH/increment target
    targetId: string; // title id (Number() for REST)
    targetType: RateTargetType;
    name: string;
    russian: string | null;
    posterUrl: string | null;
    posterUrl2x: string | null;
    status: UserRateStatus;
    score: number; // 0 = no score
    progress: number; // my episodes (anime) or chapters (manga/ranobe)
    total: number; // total episodes/chapters, 0 = unknown
    url?: string | null; // title page, see TitleCard.url
}

// A row of the ongoings calendar (US-9, phase 7): a still-airing title from my
// lists, read via animes(mylist:, status: "ongoing"). Anime-only by
// construction — Manga has no nextEpisodeAt (docs/03).
//
// Structurally satisfies ScheduleItem (src/lib/calendar-schedule.ts): the
// schedule layer is generic over it and hands these rows back untouched, so the
// four fields it reads (nextEpisodeAt, episodes, episodesAired, progress) must
// keep their names and types.
export interface CalendarItem {
    rateId: string; // user_rate id; the calendar is read-only, but this is the row identity
    targetId: string; // title id (Number() for REST), also the poster-backfill key
    name: string;
    russian: string | null;
    // My list status. The calendar mixes «Смотрю»/«Пересматриваю» with
    // «Запланировано» (docs/06, owner-verification 2026-07-28), and without a
    // badge those rows would be indistinguishable.
    status: UserRateStatus;
    posterUrl: string | null;
    posterUrl2x: string | null;
    // Raw ISO8601 with offset, exactly as the API returned it. Formatting lives
    // in the schedule layer on purpose: a preformatted «сегодня 17:15» in the
    // session cache would have to be invalidated by the clock.
    nextEpisodeAt: string | null; // null for ~8% of ongoings (docs/03)
    episodes: number; // total, 0 = unknown (One Piece)
    episodesAired: number;
    progress: number; // my watched episodes (userRate.episodes)
    url?: string | null; // title page, see TitleCard.url
}

// A row of the background airing poll (US-12, phase 11): the same "my ongoings"
// list as the calendar, read through the narrow poll query — six fields instead
// of ten, because it runs every 30 minutes and draws nothing (docs/03,
// «Опрос — эталонный запрос»). Anime-only for the same reason as the calendar:
// Manga has neither episodesAired nor nextEpisodeAt.
//
// Structurally satisfies three consumers, all keyed on field names, so none of
// them can be renamed here alone: BacklogItem (src/lib/calendar-schedule.ts), so
// the badge counts exactly the `behind` the calendar row prints; AiredObservation
// (src/lib/aired-snapshot.ts), so the poll result goes into the diff untouched;
// and TitleNames (src/lib/title-name.ts), so the notification names the title
// through the same displayTitle the screens use.
//
// `rateId` is carried even though the background stays read-only (docs/06, phase
// 11 boundaries): the badge is written here but edited from the popup, and a
// write answers with the rate id alone (RateState). It is the only identity that
// lets «+1 эпизод» move the counter at once instead of at the next tick (Ф11-9);
// the poll itself and the notification still address a title by `targetId`.
export interface AiredPollItem {
    targetId: string; // title id; the snapshot key and the id the popup opens by
    rateId: string; // user_rate id — how a write from the popup finds this row
    name: string; // romaji, non-null; the notification title per `titleLang`
    russian: string | null;
    episodesAired: number;
    // Raw ISO8601 with offset, as returned. Data for the message, never a
    // schedule: a third of the ongoings carry no date at all (docs/03).
    nextEpisodeAt: string | null;
    progress: number; // my watched episodes (userRate.episodes)
    // Ф11-16: where a click on the notification goes. Taken from the answer and
    // never assembled here (Ф6-26, CLAUDE.md rule 4) — the domain has changed
    // four times, and the answer already carries the one it came from. Typed
    // nullable for the same defensive reason as RawAnime.url: a missing address
    // costs the click, not the message.
    url: string | null;
}

// Search result card (US-2). Nullability mirrors the GraphQL schema per the
// docs/03 introspection results (2026-07-23).
export interface TitleCard {
    id: string; // GraphQL ID! serializes as a numeric string; REST target_id = Number(id)
    targetType: RateTargetType; // REST write target; ranobe cards carry 'Manga'
    name: string; // romaji, non-null
    russian: string | null;
    kind: string | null; // AnimeKindEnum / MangaKindEnum value
    score: number | null; // 0.0 = no score yet (announcements)
    status: string | null; // AnimeStatusEnum / MangaStatusEnum value
    // Progress totals depend on the media: the anime mapper fills episodes*,
    // the manga/ranobe mapper fills chapters/volumes.
    episodes?: number;
    episodesAired?: number;
    chapters?: number;
    volumes?: number;
    year: number | null; // airedOn.year
    posterUrl: string | null; // poster.miniUrl, 60×94 webp
    posterUrl2x: string | null; // poster.mini2xUrl, retina
    userRate: UserRateRef | null; // null without Bearer or when not in my list
    // Absolute title page url as returned by the API — always on the domain the
    // response came from, so the origin setting is honoured without building
    // any url in the code (CLAUDE.md rule 4). Optional on read: records cached
    // in storage.session by an older build carry no url, and the UI then simply
    // renders the title without a link.
    url?: string | null;
}

// Kinds of a link between two titles — RelationKindEnum, all 12 values as of the
// introspection of 2026-08-10 (docs/03). This union is OUR copy of a server enum
// and not a contract: Shikimori may add a value without warning, so everything
// that consumes it goes through normalizeRelationKind (src/lib/related.ts)
// instead of assuming the string is one of these.
export type RelationKind =
    | 'adaptation'
    | 'alternative_setting'
    | 'alternative_version'
    | 'character'
    | 'full_story'
    | 'other'
    | 'parent_story'
    | 'prequel'
    | 'sequel'
    | 'side_story'
    | 'spin_off'
    | 'summary';

// A row of the related-titles screen (US-11, phase 12): a title card plus the
// kind of its link to the title we came from. A wrapper rather than extra fields
// on TitleCard (the CalendarItem precedent is the other way round on purpose):
// the very same title is a plain search card elsewhere, and the relation belongs
// to the link, not to the title — the same card appears with a different
// relationKind when opened from its neighbour.
//
// Anime.related and Manga.related fill exactly one of anime/manga per element
// (docs/03), so a mixed list of both media is normal here: `card.targetType`
// tells them apart, and Related.id — the id of the LINK, volatile — is dropped
// by the mapper as unusable for keys or caching.
//
// ASSUMPTION (Ф12-1, not yet verified by the owner): `card.userRate` inside
// related comes back non-null under Bearer for a title that is in my lists. The
// public request answers null for every element, which does not distinguish
// "not in my lists" from "the field does not work nested". If it turns out to be
// the latter, the status badge on the screen needs a separate request.
export interface RelatedItem {
    relationKind: RelationKind;
    // The server's own Russian wording of this relation («Адаптация», «Другая
    // история»). Kept as row meta and NOT used as a group heading: anime and
    // manga word the SAME relationKind differently (docs/03), so headings come
    // from our own map (i18n) while this stays exactly as the server said it.
    relationText: string;
    card: TitleCard;
}

// Raw wire shapes of the GraphQL responses (Raw*) live next to their queries in
// api/graphql.ts: this file is the surface shared with background, messaging and
// UI, while the wire shapes stay internal to the read layer (docs/02, module tree).

// Params of REST v2 user_rates writes (docs/03). rates.ts maps them to the
// snake_case wire body; user_id is never part of these params — background
// takes it from stored auth.user (docs/02).
export interface RateCreateParams {
    targetId: string; // TitleCard.id; converted with Number() for REST
    targetType: RateTargetType;
    status: UserRateStatus;
}

// PATCH /api/v2/user_rates/{id} body fields (docs/03).
export interface RatePatch {
    status?: UserRateStatus;
    score?: number; // 0–10, 0 = no score
    episodes?: number;
    chapters?: number;
    volumes?: number;
    rewatches?: number;
    text?: string;
}
