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
