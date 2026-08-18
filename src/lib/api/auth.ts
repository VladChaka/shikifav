import { browser } from 'wxt/browser';
import { clearBadge } from '../badge';
import { CLIENT_ID, CLIENT_SECRET } from '../config';
import { clearAiredNotifications } from '../episode-notifications';
import { httpsHref } from '../external-url';
import { bumpSessionEpoch } from '../session-epoch';
import {
    clearAiredSnapshot,
    clearSession,
    getLocal,
    getSettings,
    removeLocal,
    setLocal,
} from '../storage';
import { apiRequest, oauthRequest, setTokenProvider } from './http';
import type { ApiRequestOptions, HttpResult } from './http';
import { isApiError } from './types';
import type { ApiError, AuthState, User } from './types';

// OAuth2 authorization code flow and token lifecycle (docs/04-auth.md).
// Background-only module: tokens never leave storage/this layer.

interface TokenResponse {
    access_token: string;
    // Absent on some refresh responses; the exchange response must have it.
    refresh_token?: string;
    expires_in: number;
    created_at?: number; // unix seconds
}

// Shape confirmed on the first live login, 2026-07-22 (docs/03, checkbox
// «Форма ответа whoami»): id, nickname and avatar arrive as typed below.
interface WhoamiResponse {
    id: number;
    nickname: string;
    avatar: string | null;
}

const OAUTH_SCOPE = 'user_rates';
const EXPIRES_AT_MARGIN_SECONDS = 60;

// PKCE layer on top of the confidential-client flow (docs/04 §5). Live probe
// verdict (2026-07-22): Shikimori's Doorkeeper rejects token requests without
// client authentication (401 invalid_client), so client_secret is always sent;
// PKCE (S256 challenge + code_verifier) stays as an extra code-interception
// guard. ROLLBACK of the PKCE layer only: set false. The secret is not
// flag-controlled — every token request carries it regardless.
const PKCE_ENABLED = true;

// 32 random bytes -> 43 base64url chars, within RFC 7636's 43..128 range.
const PKCE_VERIFIER_BYTES = 32;

interface PkcePair {
    verifier: string;
    challenge: string;
}

// Exported for tests (RFC 7636 §4.1: unreserved chars, 43..128 length).
export function generateCodeVerifier(): string {
    return base64UrlEncode(crypto.getRandomValues(new Uint8Array(PKCE_VERIFIER_BYTES)));
}

// Exported for tests (RFC 7636 §4.2: S256, verified against the appendix B vector).
export async function computeCodeChallenge(verifier: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function createPkcePair(): Promise<PkcePair> {
    const verifier = generateCodeVerifier();
    return { verifier, challenge: await computeCodeChallenge(verifier) };
}

// Pure on purpose: unit-tested without timers (docs/02 "Тестирование").
export function computeExpiresAt(
    expiresInSeconds: number,
    createdAtSeconds: number | undefined,
    nowMs: number,
): number {
    const issuedAtSeconds = createdAtSeconds ?? Math.floor(nowMs / 1000);
    return (issuedAtSeconds + expiresInSeconds - EXPIRES_AT_MARGIN_SECONDS) * 1000;
}

// The only place that touches CLIENT_SECRET. The server requires client
// authentication on every token request (exchange and refresh): the PKCE-only
// probe got 401 invalid_client (docs/04 §5).
function clientAuthParams(): Record<string, string> {
    return { client_id: CLIENT_ID, client_secret: CLIENT_SECRET };
}

// Single-flight like refreshInFlight below: two concurrent logins would
// interleave setTokenProvider in loginWhoami and break the second whoami.
let loginInFlight: Promise<User> | undefined;

export function login(): Promise<User> {
    loginInFlight ??= doLogin().finally(() => {
        loginInFlight = undefined;
    });
    return loginInFlight;
}

async function doLogin(): Promise<User> {
    const settings = await getSettings();
    const redirectUri = browser.identity.getRedirectURL();
    const pkce = PKCE_ENABLED ? await createPkcePair() : undefined;
    const authorizeParams = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: OAUTH_SCOPE,
    });
    if (pkce) {
        authorizeParams.set('code_challenge', pkce.challenge);
        authorizeParams.set('code_challenge_method', 'S256');
    }

    let resultUrl: string | undefined;
    try {
        resultUrl = await browser.identity.launchWebAuthFlow({
            url: `${settings.origin}/oauth/authorize?${authorizeParams.toString()}`,
            interactive: true,
        });
    } catch {
        // Chrome rejects when the user closes the window without approving.
        throw internalError('Authorization window was closed');
    }
    let code: string | null = null;
    if (resultUrl) {
        try {
            code = new URL(resultUrl).searchParams.get('code');
        } catch {
            // A raw TypeError would carry the whole URL (with the auth code)
            // into the messaging dispatcher's console.debug — never rethrow it.
            throw internalError('Invalid redirect URL');
        }
    }
    if (!code) {
        throw internalError('No authorization code in redirect');
    }

    const tokens = await exchangeCode(code, redirectUri, pkce?.verifier);
    if (!tokens.refresh_token) {
        throw internalError('No refresh token in OAuth response');
    }
    const user = await loginWhoami(tokens.access_token);
    // Auth is persisted as ONE object only after whoami succeeds: a failed
    // login leaves storage fully anonymous, never half-authorized.
    await setLocal('auth', {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: computeExpiresAt(tokens.expires_in, tokens.created_at, Date.now()),
        user,
    });
    // Ф11-6, account switch: the airing snapshot describes the lists of whoever
    // was logged in before, and a login is the only moment that can change that
    // person. Dropped unconditionally rather than only on a different user id —
    // re-seeding is silent and costs nothing, while a stale snapshot would make
    // the badge count someone else's backlog. AFTER the auth write on purpose: a
    // poll firing in between would otherwise re-seed under the previous token.
    await dropAiredSnapshot();
    // Ф11-10: a poll started for the previous account can still be in the air,
    // and it cannot be cancelled. Moving the epoch makes it write nothing when
    // it lands — otherwise it would re-seed the snapshot it read before this
    // line and notify about increases of lists that are no longer ours.
    bumpSessionEpoch();
    return user;
}

async function exchangeCode(
    code: string,
    redirectUri: string,
    codeVerifier: string | undefined,
): Promise<TokenResponse> {
    const result = await oauthRequest<TokenResponse>('/oauth/token', {
        ...clientAuthParams(),
        ...(codeVerifier === undefined ? {} : { code_verifier: codeVerifier }),
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
    });
    if (!result.ok) {
        throw result.error;
    }
    return result.data;
}

// During login the fresh token is not in storage yet (see login()), so it is
// injected into http directly; ensureToken is restored either way.
async function loginWhoami(accessToken: string): Promise<User> {
    setTokenProvider(async () => accessToken);
    try {
        return await whoami();
    } finally {
        setTokenProvider(ensureToken);
    }
}

async function whoami(): Promise<User> {
    const result = await apiRequest<WhoamiResponse>('/api/users/whoami');
    if (!result.ok) {
        throw result.error;
    }
    return {
        id: result.data.id,
        nickname: result.data.nickname,
        // The avatar goes straight into an <img src>, so it passes the same
        // https guard as an outbound link; a refused url is stored as '', which
        // the header already renders as "no avatar" instead of a broken image.
        avatarUrl: httpsHref(result.data.avatar) ?? '',
    };
}

// Single-flight guard. Module state here is only an optimization within one SW
// lifetime; correctness relies on re-reading storage inside doRefresh.
let refreshInFlight: Promise<string> | undefined;

// Token provider (registered via setTokenProvider on every SW start): resolves
// with a valid access token or throws an ApiError. Rules from docs/04 §3.
export async function ensureToken(): Promise<string> {
    // Always read storage, not memory: the SW restarts at will (docs/04 §3.1).
    const auth = await getLocal('auth');
    if (!auth) {
        throw unauthorizedError();
    }
    if (Date.now() < auth.expiresAt) {
        return auth.accessToken;
    }
    return startRefresh(undefined);
}

// Forced refresh for a 401 on a token still valid by time — it was revoked on
// the site (docs/04 §3.6). staleAccessToken tells doRefresh what to compare
// against, since expiresAt cannot detect this case.
export async function forceRefresh(staleAccessToken: string): Promise<string> {
    return startRefresh(staleAccessToken);
}

function startRefresh(staleAccessToken: string | undefined): Promise<string> {
    refreshInFlight ??= doRefresh(staleAccessToken).finally(() => {
        refreshInFlight = undefined;
    });
    return refreshInFlight;
}

async function doRefresh(staleAccessToken: string | undefined): Promise<string> {
    // Re-read right before the network call: another caller may have already
    // refreshed while this one was queueing (docs/04 §3.3).
    const auth = await getLocal('auth');
    if (!auth) {
        throw unauthorizedError();
    }
    const alreadyRefreshed =
        staleAccessToken === undefined
            ? Date.now() < auth.expiresAt
            : auth.accessToken !== staleAccessToken;
    if (alreadyRefreshed) {
        return auth.accessToken;
    }

    const result = await oauthRequest<TokenResponse>('/oauth/token', {
        ...clientAuthParams(),
        grant_type: 'refresh_token',
        refresh_token: auth.refreshToken,
    });
    if (!result.ok) {
        // invalid_grant / 400 / 401 → the session is gone: clear auth, go
        // anonymous. Transient failures (network, 429, 5xx) keep auth intact.
        // No automatic refresh retries either way (docs/04 §3.5).
        if (isSessionGone(result.error)) {
            await clearAuth();
            throw unauthorizedError();
        }
        throw result.error;
    }
    await setLocal('auth', {
        accessToken: result.data.access_token,
        // The response may carry a rotated refresh token — always keep the
        // latest one (docs/04 §3.4).
        refreshToken: result.data.refresh_token ?? auth.refreshToken,
        expiresAt: computeExpiresAt(result.data.expires_in, result.data.created_at, Date.now()),
        user: auth.user,
    });
    return result.data.access_token;
}

function isSessionGone(error: ApiError): boolean {
    return (
        error.kind === 'unauthorized' ||
        (error.kind === 'api' && (error.status === 400 || error.status === 401))
    );
}

// API request with the 401 policy of docs/04 §3.6: one forced refresh, one
// retry, then clear auth. Later phases (graphql/rates) call this instead of
// apiRequest directly.
export async function authorizedRequest<T>(
    path: string,
    options?: ApiRequestOptions,
): Promise<HttpResult<T>> {
    const first = await apiRequest<T>(path, options);
    if (first.ok || first.error.kind !== 'unauthorized') {
        return first;
    }
    const auth = await getLocal('auth');
    if (!auth) {
        return first;
    }
    try {
        await forceRefresh(auth.accessToken);
    } catch (e) {
        return { ok: false, error: isApiError(e) ? e : unauthorizedError() };
    }
    const second = await apiRequest<T>(path, options);
    if (!second.ok && second.error.kind === 'unauthorized') {
        // Still 401 on a fresh token — give up and go anonymous (docs/04 §3.5),
        // without looping.
        await clearAuth();
    }
    return second;
}

// Storage-only by design: opening the popup must never trigger network
// (docs/05 "Никаких блокирующих запросов при открытии popup").
export async function getAuthState(): Promise<AuthState> {
    const auth = await getLocal('auth');
    if (!auth) return { status: 'anonymous' };
    // The stored avatar predates the guard in whoami() for anyone who logged in
    // on an earlier build, and unlike the poster cache it survives restarts —
    // so it is filtered on the way out too, not only on the way in.
    return {
        status: 'authorized',
        user: { ...auth.user, avatarUrl: httpsHref(auth.user.avatarUrl) ?? '' },
    };
}

export async function logout(): Promise<void> {
    await clearAuth();
}

// Called on logout AND from a refresh that lost the session — including one
// inside a background poll (docs/06, phase 11 «Риск, который фаза обязана
// закрыть кодом»). The airing snapshot goes with auth: it is personal data of
// an account that is no longer logged in, and keeping it would let the badge
// keep counting a backlog nobody can see anymore.
//
// The badge goes out here and not only in the handlers above it, because this is
// the single point where every way out of a session meets: «Выйти», the domain
// switch (settings.setOrigin logs out first), and a refresh that lost the
// session in a popup request — the last one reaches no catch of the background
// tick, so a badge cleared anywhere else would survive it and be redrawn by
// restoreBadge() on every worker start until the next tick or login.
async function clearAuth(): Promise<void> {
    // FIRST, before anything else here — and the comment used to say so while
    // the call stood second (нит ревью). It is now where it claims to be, and
    // the position is not cosmetic: it is synchronous and cannot fail, so from
    // this line on a background tick started under the session being cleared
    // writes nothing at all (Ф11-10), including during the awaits below. Without
    // it that tick would put the snapshot and the badge of a finished session
    // back after the wipe — the icon would keep a number, storage would keep
    // list data of an account nobody is logged into, and restoreBadge() would
    // redraw both on every worker start.
    bumpSessionEpoch();
    await removeLocal('auth');
    await dropAiredSnapshot();
    // Total by construction (src/lib/badge.ts): it swallows its own failures, so
    // it can stand between the snapshot delete and clearSession() without ever
    // skipping the latter — the same rule dropAiredSnapshot() follows.
    await clearBadge();
    // Ф11 audit. Notifications already shown carry the names of titles from the
    // lists of the account that is leaving, and the system centre keeps them for
    // as long as the user lets it — they would sit there next to our icon and our
    // name long after the logout. Total for the same reason as clearBadge().
    await clearAiredNotifications();
    await clearSession();
}

// The snapshot delete is the one step of a login/logout that stands PAST the
// point of success: by the time it runs, the session has already been written
// (doLogin) or already been removed (clearAuth). A rejected storage write there
// would report a failed login on a live session, or skip clearSession() and
// leave the popup caches of a session that is gone — both worse than what a
// surviving snapshot costs, which is one wrong badge count until the next
// login or logout clears it. Hence: swallowed, kind only in the log, never the
// error itself — it may carry storage contents.
async function dropAiredSnapshot(): Promise<void> {
    try {
        await clearAiredSnapshot();
    } catch (e) {
        console.debug(
            '[auth] failed to clear the airing snapshot:',
            e instanceof Error ? e.name : typeof e,
        );
    }
}

function unauthorizedError(): ApiError {
    return { kind: 'unauthorized' };
}

function internalError(message: string): ApiError {
    return { kind: 'internal', message };
}
