// Shared API types used across background, messaging and UI (docs/02-architecture.md).

export type ApiError =
    | { kind: 'network' } // fetch failed / timeout
    | { kind: 'unauthorized' } // 401 after a refresh attempt
    | { kind: 'rate_limited'; retryAfterMs?: number }
    | { kind: 'api'; status: number; message: string } // 4xx/5xx, including 422
    | { kind: 'internal'; message: string };

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
