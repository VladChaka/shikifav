// Origin and OAuth app credentials. Domains historically change — never
// hardcode Shikimori URLs anywhere else (CLAUDE.md rule 4).

declare global {
    // Merged into the WXT-generated ImportMetaEnv (values come from .env, see .env.example).
    interface ImportMetaEnv {
        readonly WXT_SHIKI_APP_NAME?: string;
        readonly WXT_SHIKI_CLIENT_ID?: string;
        readonly WXT_SHIKI_CLIENT_SECRET?: string;
        readonly WXT_GA4_MEASUREMENT_ID?: string;
        readonly WXT_GA4_API_SECRET?: string;
    }
}

export const ORIGINS = ['https://shikimori.one', 'https://shikimori.io'] as const;
export type Origin = (typeof ORIGINS)[number];

// Default is .io: .one 301-redirects POST /oauth/token to .io, which turns the
// POST into a GET (verified 2026-07-22, docs/03).
export const DEFAULT_ORIGIN: Origin = 'https://shikimori.io';

export const APP_NAME: string = import.meta.env.WXT_SHIKI_APP_NAME ?? '';
export const CLIENT_ID: string = import.meta.env.WXT_SHIKI_CLIENT_ID ?? '';
// Secret: never log it and never include it in error messages (CLAUDE.md rule 6).
export const CLIENT_SECRET: string = import.meta.env.WXT_SHIKI_CLIENT_SECRET ?? '';

// GA4 Measurement Protocol (фаза 10). Both empty in a checkout without an
// analytics property, and that is a supported state: the client turns into a
// no-op instead of failing, exactly like the empty donation list of phase 8.
// The api_secret shares the fate of client_secret — it ships inside the bundle
// and cannot be hidden there (docs/04 §5). What it buys an attacker is narrower:
// it writes events into the property, it does not read anything out of it.
export const GA4_MEASUREMENT_ID: string = import.meta.env.WXT_GA4_MEASUREMENT_ID ?? '';
export const GA4_API_SECRET: string = import.meta.env.WXT_GA4_API_SECRET ?? '';
export const GA4_ENDPOINT = 'https://www.google-analytics.com/mp/collect';
