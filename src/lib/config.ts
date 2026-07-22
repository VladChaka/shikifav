// Origin and OAuth app credentials. Domains historically change — never
// hardcode Shikimori URLs anywhere else (CLAUDE.md rule 4).

declare global {
    // Merged into the WXT-generated ImportMetaEnv (values come from .env, see .env.example).
    interface ImportMetaEnv {
        readonly WXT_SHIKI_APP_NAME?: string;
        readonly WXT_SHIKI_CLIENT_ID?: string;
        readonly WXT_SHIKI_CLIENT_SECRET?: string;
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
