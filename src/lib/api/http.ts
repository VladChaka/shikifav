import { APP_NAME } from '../config';
import { DEFAULT_SETTINGS, getLocal } from '../storage';
import { isApiError } from './types';
import type { ApiError } from './types';

// The single network entry point of the extension (CLAUDE.md rule 1, ADR-1).
// fetch() anywhere else in the codebase is forbidden.

export type HttpResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

// Token is injected to avoid a circular http <-> auth import: auth.ts registers
// the provider on background startup. Module-level state is safe here because
// defineBackground() runs (and re-registers) on every service worker start.
// Contract: resolve with a valid access token, or throw an ApiError when the
// user must re-login (a non-ApiError throw is mapped to 'unauthorized').
export type TokenProvider = () => Promise<string>;

let tokenProvider: TokenProvider | undefined;

export function setTokenProvider(provider: TokenProvider): void {
    tokenProvider = provider;
}

export interface ApiRequestOptions {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown; // JSON-serialized when present
}

// OAuth token endpoint level: form-urlencoded, no Bearer (docs/04 §2-3).
export async function oauthRequest<T>(
    path: string,
    form: Record<string, string>,
): Promise<HttpResult<T>> {
    return performRequest<T>({
        path,
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form).toString(),
    });
}

// API level: JSON + Bearer (docs/03). The 401 -> refresh -> retry-once policy
// lives in the auth layer; here 401 is only mapped to 'unauthorized'.
export async function apiRequest<T>(
    path: string,
    options: ApiRequestOptions = {},
): Promise<HttpResult<T>> {
    if (!tokenProvider) {
        return fail({ kind: 'internal', message: 'Token provider is not registered' });
    }
    let token: string;
    try {
        token = await tokenProvider();
    } catch (e) {
        return fail(isApiError(e) ? e : { kind: 'unauthorized' });
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    let body: string | undefined;
    if (options.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(options.body);
    }
    return performRequest<T>({ path, method: options.method ?? 'GET', headers, body });
}

interface RequestSpec {
    path: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
}

// Single choke point for every network call: the phase 2 rate limiter
// (4 rps / 80 rpm, backoff on 429) wraps exactly this function (docs/02).
async function performRequest<T>(spec: RequestSpec): Promise<HttpResult<T>> {
    // A request with an empty User-Agent risks an IP ban (CLAUDE.md rule 3),
    // so an unconfigured .env must fail before any fetch.
    if (!APP_NAME) {
        return fail({ kind: 'internal', message: 'APP_NAME is not configured' });
    }
    // Origin is re-read from storage on every request: the service worker
    // restarts at will, so caching it in a module variable would go stale
    // (CLAUDE.md rule 4).
    const settings = (await getLocal('settings')) ?? DEFAULT_SETTINGS;

    let response: Response;
    try {
        response = await fetch(`${settings.origin}${spec.path}`, {
            method: spec.method,
            // User-Agent = OAuth app name on every request (CLAUDE.md rule 3).
            headers: { 'User-Agent': APP_NAME, ...spec.headers },
            body: spec.body,
        });
    } catch {
        return fail({ kind: 'network' });
    }

    if (!response.ok) {
        return fail(await mapErrorResponse(response));
    }

    console.debug('[http] status:', response.status);
    if (response.status === 204) {
        // No body on 204 (DELETE user_rates); callers use apiRequest<undefined>.
        return { ok: true, data: undefined as unknown as T };
    }
    try {
        return { ok: true, data: (await response.json()) as T };
    } catch {
        return fail({ kind: 'internal', message: 'Invalid JSON in response body' });
    }
}

// Status -> ApiError mapping (model in docs/02, table in docs/03).
async function mapErrorResponse(response: Response): Promise<ApiError> {
    if (response.status === 401) {
        return { kind: 'unauthorized' };
    }
    if (response.status === 429) {
        const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'));
        return retryAfterMs === undefined
            ? { kind: 'rate_limited' }
            : { kind: 'rate_limited', retryAfterMs };
    }
    return { kind: 'api', status: response.status, message: await readErrorMessage(response) };
}

function parseRetryAfter(header: string | null): number | undefined {
    if (header === null) {
        return undefined;
    }
    const seconds = Number(header);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

const ERROR_MESSAGE_MAX_LENGTH = 200;

// Extracts a human-readable message for the UI (e.g. 422 validation, docs/03).
// Known body shapes: ["Validation error", ...] (REST v2),
// { "error": "...", "error_description": "..." } (oauth), { "message": "..." }.
async function readErrorMessage(response: Response): Promise<string> {
    let text: string;
    try {
        text = await response.text();
    } catch {
        return response.statusText;
    }
    try {
        const parsed: unknown = JSON.parse(text);
        if (Array.isArray(parsed)) {
            const message = parsed.filter((item) => typeof item === 'string').join('; ');
            if (message) {
                return message;
            }
        } else if (typeof parsed === 'object' && parsed !== null) {
            const record = parsed as Record<string, unknown>;
            for (const key of ['error_description', 'message', 'error']) {
                const value = record[key];
                if (typeof value === 'string' && value) {
                    return value;
                }
            }
        }
    } catch {
        // Not JSON — fall through to raw text.
    }
    return text.slice(0, ERROR_MESSAGE_MAX_LENGTH).trim() || response.statusText;
}

// Only kind/status reach the logs — never bodies, headers or tokens
// (CLAUDE.md rule 6, docs/02 error model).
function fail(error: ApiError): { ok: false; error: ApiError } {
    if (error.kind === 'api') {
        console.debug('[http] error:', error.kind, error.status);
    } else {
        console.debug('[http] error:', error.kind);
    }
    return { ok: false, error };
}
