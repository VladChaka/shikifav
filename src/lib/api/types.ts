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
