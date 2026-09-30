import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import background from '@/entrypoints/background';
import { showAiredBacklog } from '../badge';
import { runEpisodeWatchTick } from '../episode-watch';
import { sendMessage } from '../messaging';
import { isSessionEpochCurrent, sessionEpoch } from '../session-epoch';
import {
    DEFAULT_SETTINGS,
    getAiredSnapshot,
    getLocal,
    getSession,
    getSettings,
    setAiredSnapshot,
    setLocal,
    setSession,
    setSettings,
} from '../storage';
import type { LocalState } from '../storage';
import {
    authorizedRequest,
    computeCodeChallenge,
    computeExpiresAt,
    ensureToken,
    forceRefresh,
    generateCodeVerifier,
    getAuthState,
    login,
    logout,
} from './auth';
import { apiRequest, rateLimiter, setTokenProvider } from './http';
import type { ApiError, User } from './types';

const fetchMock = vi.fn<typeof fetch>();

const REDIRECT_URI = 'https://extension-id.chromiumapp.org/';

const testUser: User = { id: 7, nickname: 'tester', avatarUrl: 'https://cdn.test/x160.png' };

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status });
}

function storedAuth(overrides: Partial<NonNullable<LocalState['auth']>> = {}) {
    return {
        accessToken: 'stored-access',
        refreshToken: 'stored-refresh',
        expiresAt: Date.now() + 60 * 60 * 1000,
        user: testUser,
        ...overrides,
    };
}

interface CapturedRequest {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string | undefined;
}

function capturedRequests(): CapturedRequest[] {
    return fetchMock.mock.calls.map(([input, init]) => ({
        url: String(input),
        method: init?.method ?? 'GET',
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: typeof init?.body === 'string' ? init.body : undefined,
    }));
}

async function expectApiErrorThrow(promise: Promise<unknown>): Promise<ApiError> {
    try {
        await promise;
    } catch (e) {
        return e as ApiError;
    }
    throw new Error('Expected the promise to reject');
}

function stubIdentity(resultUrl: string): void {
    fakeBrowser.identity.getRedirectURL = (() =>
        REDIRECT_URI) as typeof fakeBrowser.identity.getRedirectURL;
    fakeBrowser.identity.launchWebAuthFlow = (async () =>
        resultUrl) as typeof fakeBrowser.identity.launchWebAuthFlow;
}

const CONSOLE_METHODS = ['debug', 'log', 'info', 'warn', 'error'] as const;

// Captures everything written to the console so tests can assert that secrets
// never reach it (CLAUDE.md rule 6, docs/04 §6). Restore via the returned fn.
function spyConsole(): { output: () => string; restore: () => void } {
    const spies = CONSOLE_METHODS.map((method) =>
        vi.spyOn(console, method).mockImplementation(() => {}),
    );
    const formatArg = (arg: unknown): string => {
        if (typeof arg === 'string') {
            return arg;
        }
        if (arg instanceof Error) {
            return `${arg.message} ${arg.stack ?? ''}`;
        }
        return JSON.stringify(arg) ?? String(arg);
    };
    return {
        output: () =>
            spies
                .flatMap((spy) => spy.mock.calls.flat())
                .map(formatArg)
                .join('\n'),
        restore: () => spies.forEach((spy) => spy.mockRestore()),
    };
}

// Makes the airing-snapshot delete — and only it — reject, the way a storage
// failure standing PAST the point of success would (Ф11-6): auth is already
// written on login and already gone on logout by the time it runs. Returns the
// spy so the test restores it, as everywhere else in this repo.
function failSnapshotRemoval() {
    const remove = fakeBrowser.storage.local.remove.bind(fakeBrowser.storage.local);
    return vi.spyOn(fakeBrowser.storage.local, 'remove').mockImplementation(async (keys) => {
        if (keys === 'airedSnapshot') {
            throw new Error('Storage delete refused');
        }
        await remove(keys);
    });
}

describe('auth', () => {
    beforeEach(() => {
        fakeBrowser.reset();
        fetchMock.mockReset();
        vi.stubGlobal('fetch', fetchMock);
        // Mirrors the registration in entrypoints/background.ts.
        setTokenProvider(ensureToken);
        // Fresh sliding window: leftover timestamps would add real-timer
        // delays and break the microtask-draining single-flight tests.
        rateLimiter.reset();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe('computeExpiresAt', () => {
        it('uses created_at when present, with a -60s margin, in ms', () => {
            expect(computeExpiresAt(86400, 1_719_830_400, 999)).toBe(
                (1_719_830_400 + 86400 - 60) * 1000,
            );
        });

        it('falls back to now (seconds) when created_at is absent', () => {
            const nowMs = 5_000_000_500; // not a whole second: must be floored
            expect(computeExpiresAt(86400, undefined, nowMs)).toBe((5_000_000 + 86400 - 60) * 1000);
        });
    });

    describe('pkce', () => {
        it('computes the S256 challenge of the RFC 7636 appendix B vector', async () => {
            await expect(
                computeCodeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
            ).resolves.toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
        });

        it('generates unreserved-only verifiers within the 43..128 length range', () => {
            const first = generateCodeVerifier();
            const second = generateCodeVerifier();
            for (const verifier of [first, second]) {
                // RFC 7636 §4.1 charset; base64url output is its subset.
                expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
            }
            expect(first).not.toBe(second);
        });
    });

    describe('ensureToken', () => {
        it('throws unauthorized without touching the network when there is no auth', async () => {
            const error = await expectApiErrorThrow(ensureToken());
            expect(error).toEqual({ kind: 'unauthorized' });
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('returns the stored token while it is valid by time', async () => {
            await setLocal('auth', storedAuth());
            await expect(ensureToken()).resolves.toBe('stored-access');
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('refreshes an expired token and persists the rotated refresh token', async () => {
            await setLocal('auth', storedAuth({ expiresAt: Date.now() - 1000 }));
            fetchMock.mockResolvedValueOnce(
                jsonResponse(200, {
                    access_token: 'new-access',
                    refresh_token: 'new-refresh',
                    expires_in: 86400,
                    created_at: 2_000_000_000,
                }),
            );

            await expect(ensureToken()).resolves.toBe('new-access');
            expect(fetchMock).toHaveBeenCalledTimes(1);

            const request = capturedRequests()[0];
            expect(request.url).toBe('https://shikimori.io/oauth/token');
            const form = new URLSearchParams(request.body);
            expect(form.get('grant_type')).toBe('refresh_token');
            expect(form.get('refresh_token')).toBe('stored-refresh');
            expect(form.get('client_id')).not.toBeNull();
            // Confidential client: the secret authenticates refresh requests
            // too (docs/04 §5, PKCE-only got 401 invalid_client).
            expect(form.get('client_secret')).not.toBeNull();

            await expect(getLocal('auth')).resolves.toEqual({
                accessToken: 'new-access',
                refreshToken: 'new-refresh',
                expiresAt: (2_000_000_000 + 86400 - 60) * 1000,
                user: testUser,
            });
        });

        it('keeps the old refresh token when the response has none', async () => {
            await setLocal('auth', storedAuth({ expiresAt: Date.now() - 1000 }));
            fetchMock.mockResolvedValueOnce(
                jsonResponse(200, { access_token: 'new-access', expires_in: 86400 }),
            );
            await ensureToken();
            const auth = await getLocal('auth');
            expect(auth?.refreshToken).toBe('stored-refresh');
        });

        it('single-flight: 3 concurrent calls share one network refresh', async () => {
            await setLocal('auth', storedAuth({ expiresAt: Date.now() - 1000 }));
            // Deferred response instead of timers: the refresh stays in-flight
            // until released, so every caller must join the same promise.
            let releaseRefresh!: (response: Response) => void;
            fetchMock.mockImplementationOnce(
                () =>
                    new Promise<Response>((resolve) => {
                        releaseRefresh = resolve;
                    }),
            );

            const calls = [ensureToken(), ensureToken(), ensureToken()];
            // Drain microtasks (bounded, no real timers) until the refresh
            // request is actually issued and can be released.
            for (let i = 0; i < 100 && fetchMock.mock.calls.length === 0; i++) {
                await Promise.resolve();
            }
            releaseRefresh(
                jsonResponse(200, {
                    access_token: 'new-access',
                    refresh_token: 'new-refresh',
                    expires_in: 86400,
                }),
            );

            await expect(Promise.all(calls)).resolves.toEqual([
                'new-access',
                'new-access',
                'new-access',
            ]);
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it('clears auth and session, then throws unauthorized on invalid_grant (400)', async () => {
            await setLocal('auth', storedAuth({ expiresAt: Date.now() - 1000 }));
            await setSession('lastTab', 'lists');
            fetchMock.mockResolvedValueOnce(
                jsonResponse(400, {
                    error: 'invalid_grant',
                    error_description: 'The provided authorization grant is invalid',
                }),
            );

            const error = await expectApiErrorThrow(ensureToken());
            expect(error).toEqual({ kind: 'unauthorized' });
            await expect(getLocal('auth')).resolves.toBeUndefined();
            await expect(getSession('lastTab')).resolves.toBeUndefined();
        });

        // Ф11-6, the risk phase 11 has to close in code: a failed refresh inside
        // a background tick goes through the same clearAuth(), so the snapshot
        // must leave with auth there too — otherwise the next tick would count a
        // backlog of a session that no longer exists.
        it('clears the airing snapshot when a background refresh loses the session', async () => {
            await setLocal('auth', storedAuth({ expiresAt: Date.now() - 1000 }));
            await setAiredSnapshot({ '21': 1147 });
            fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: 'invalid_grant' }));

            await expectApiErrorThrow(ensureToken());

            await expect(getLocal('airedSnapshot')).resolves.toBeUndefined();
        });

        // Ревью Ф11-9: this is the OTHER way a session dies without a frame on
        // screen — a refresh that fails inside a request made from the popup.
        // The catch in the background tick never sees it, so the badge has to be
        // wiped by clearAuth() itself; otherwise the icon keeps the number and
        // restoreBadge() redraws it on every worker start until the next tick.
        it('wipes the badge when a refresh outside the tick loses the session', async () => {
            await setLocal('auth', storedAuth({ expiresAt: Date.now() - 1000 }));
            await showAiredBacklog([{ rateId: '1', episodesAired: 8, progress: 3 }]);
            fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: 'invalid_grant' }));

            await expectApiErrorThrow(ensureToken());

            expect(await fakeBrowser.action.getBadgeText({})).toBe('');
            await expect(getLocal('badgeBacklog')).resolves.toBeUndefined();
        });

        it('keeps the badge on a transient refresh failure', async () => {
            await setLocal('auth', storedAuth({ expiresAt: Date.now() - 1000 }));
            await showAiredBacklog([{ rateId: '1', episodesAired: 8, progress: 3 }]);
            fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

            await expectApiErrorThrow(ensureToken());

            // Auth survives a network blip, and so does the number: nothing about
            // the lists changed (docs/04 §3.5).
            expect(await fakeBrowser.action.getBadgeText({})).toBe('1');
        });

        it('keeps the airing snapshot on a transient refresh failure', async () => {
            await setLocal('auth', storedAuth({ expiresAt: Date.now() - 1000 }));
            await setAiredSnapshot({ '21': 1147 });
            fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

            await expectApiErrorThrow(ensureToken());

            // Auth survives a network blip (docs/04 §3.5), and so must the
            // snapshot: re-seeding would cost the next episode of every title.
            await expect(getAiredSnapshot()).resolves.toEqual({ '21': 1147 });
        });

        it('keeps auth intact on a transient network failure (no auto-retry)', async () => {
            const auth = storedAuth({ expiresAt: Date.now() - 1000 });
            await setLocal('auth', auth);
            fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

            const error = await expectApiErrorThrow(ensureToken());
            expect(error).toEqual({ kind: 'network' });
            await expect(getLocal('auth')).resolves.toEqual(auth);
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it('clears auth and throws unauthorized on a 401 refresh response', async () => {
            await setLocal('auth', storedAuth({ expiresAt: Date.now() - 1000 }));
            fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }));

            const error = await expectApiErrorThrow(ensureToken());
            expect(error).toEqual({ kind: 'unauthorized' });
            await expect(getLocal('auth')).resolves.toBeUndefined();
        });

        it('goes anonymous after a failed refresh and the next call fails fast without looping', async () => {
            await setLocal('auth', storedAuth({ expiresAt: Date.now() - 1000 }));
            fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: 'invalid_grant' }));

            await expectApiErrorThrow(ensureToken());
            await expect(getAuthState()).resolves.toEqual({ status: 'anonymous' });

            // A repeated call must throw from storage without a new refresh
            // attempt (docs/04 §3.5: no loops, no automatic retries).
            const error = await expectApiErrorThrow(ensureToken());
            expect(error).toEqual({ kind: 'unauthorized' });
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it('keeps auth intact on a 5xx refresh response (docs/04 §3.5)', async () => {
            const auth = storedAuth({ expiresAt: Date.now() - 1000 });
            await setLocal('auth', auth);
            fetchMock.mockResolvedValueOnce(new Response('Bad gateway', { status: 502 }));

            const error = await expectApiErrorThrow(ensureToken());
            expect(error).toEqual({ kind: 'api', status: 502, message: 'Bad gateway' });
            await expect(getLocal('auth')).resolves.toEqual(auth);
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it('keeps auth intact on a 429 refresh response (docs/04 §3.5)', async () => {
            const auth = storedAuth({ expiresAt: Date.now() - 1000 });
            await setLocal('auth', auth);
            fetchMock.mockResolvedValueOnce(
                new Response('', { status: 429, headers: { 'Retry-After': '2' } }),
            );

            const error = await expectApiErrorThrow(ensureToken());
            expect(error).toEqual({ kind: 'rate_limited', retryAfterMs: 2000 });
            await expect(getLocal('auth')).resolves.toEqual(auth);
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });
    });

    describe('forceRefresh', () => {
        it('re-reads storage and skips the network when another context already refreshed', async () => {
            await setLocal('auth', storedAuth({ accessToken: 'already-fresh' }));
            await expect(forceRefresh('revoked-stale')).resolves.toBe('already-fresh');
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('refreshes over the network even though the token is valid by time', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(
                jsonResponse(200, {
                    access_token: 'new-access',
                    refresh_token: 'new-refresh',
                    expires_in: 86400,
                }),
            );
            await expect(forceRefresh('stored-access')).resolves.toBe('new-access');
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });
    });

    describe('authorizedRequest', () => {
        it('passes a successful response through with a single request', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 1 }));
            const result = await authorizedRequest<{ id: number }>('/api/users/whoami');
            expect(result).toEqual({ ok: true, data: { id: 1 } });
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it('passes a non-401 error through without refreshing', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(jsonResponse(422, ['Score is invalid']));
            const result = await authorizedRequest('/api/v2/user_rates/1');
            expect(result).toEqual({
                ok: false,
                error: { kind: 'api', status: 422, message: 'Score is invalid' },
            });
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it('on 401 with a time-valid token: one forced refresh, one retry', async () => {
            await setLocal('auth', storedAuth());
            fetchMock
                .mockResolvedValueOnce(new Response('', { status: 401 }))
                .mockResolvedValueOnce(
                    jsonResponse(200, {
                        access_token: 'new-access',
                        refresh_token: 'new-refresh',
                        expires_in: 86400,
                    }),
                )
                .mockResolvedValueOnce(jsonResponse(200, { id: 1 }));

            const result = await authorizedRequest<{ id: number }>('/api/users/whoami');
            expect(result).toEqual({ ok: true, data: { id: 1 } });

            const requests = capturedRequests();
            expect(requests.map((r) => r.url)).toEqual([
                'https://shikimori.io/api/users/whoami',
                'https://shikimori.io/oauth/token',
                'https://shikimori.io/api/users/whoami',
            ]);
            expect(requests[2].headers['Authorization']).toBe('Bearer new-access');
        });

        it('clears auth and reports unauthorized when the forced refresh fails', async () => {
            await setLocal('auth', storedAuth());
            fetchMock
                .mockResolvedValueOnce(new Response('', { status: 401 }))
                .mockResolvedValueOnce(jsonResponse(401, { error: 'invalid_grant' }));

            const result = await authorizedRequest('/api/users/whoami');
            expect(result).toEqual({ ok: false, error: { kind: 'unauthorized' } });
            await expect(getLocal('auth')).resolves.toBeUndefined();
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });

        it('gives up after a second 401 without looping', async () => {
            await setLocal('auth', storedAuth());
            fetchMock
                .mockResolvedValueOnce(new Response('', { status: 401 }))
                .mockResolvedValueOnce(
                    jsonResponse(200, {
                        access_token: 'new-access',
                        refresh_token: 'new-refresh',
                        expires_in: 86400,
                    }),
                )
                .mockResolvedValueOnce(new Response('', { status: 401 }));

            const result = await authorizedRequest('/api/users/whoami');
            expect(result).toEqual({ ok: false, error: { kind: 'unauthorized' } });
            await expect(getLocal('auth')).resolves.toBeUndefined();
            expect(fetchMock).toHaveBeenCalledTimes(3);
        });
    });

    describe('login', () => {
        function mockLoginNetwork(avatar: string | null = 'https://cdn.test/x160.png'): void {
            fetchMock.mockImplementation(async (input) => {
                const url = String(input);
                if (url.endsWith('/oauth/token')) {
                    return jsonResponse(200, {
                        access_token: 'fresh-access',
                        refresh_token: 'fresh-refresh',
                        expires_in: 86400,
                        created_at: 2_000_000_000,
                    });
                }
                if (url.endsWith('/api/users/whoami')) {
                    return jsonResponse(200, { id: 7, nickname: 'tester', avatar });
                }
                throw new Error(`Unexpected request: ${url}`);
            });
        }

        it('runs the full flow and saves auth as one object', async () => {
            stubIdentity(`${REDIRECT_URI}?code=auth-code`);
            mockLoginNetwork();

            const user = await login();
            expect(user).toEqual(testUser);

            await expect(getLocal('auth')).resolves.toEqual({
                accessToken: 'fresh-access',
                refreshToken: 'fresh-refresh',
                expiresAt: (2_000_000_000 + 86400 - 60) * 1000,
                user: testUser,
            });

            const [exchange, whoami] = capturedRequests();
            expect(exchange.url).toBe('https://shikimori.io/oauth/token');
            const form = new URLSearchParams(exchange.body);
            expect(form.get('grant_type')).toBe('authorization_code');
            expect(form.get('code')).toBe('auth-code');
            expect(form.get('redirect_uri')).toBe(REDIRECT_URI);
            // whoami runs with the fresh token before auth reaches storage.
            expect(whoami.url).toBe('https://shikimori.io/api/users/whoami');
            expect(whoami.headers['Authorization']).toBe('Bearer fresh-access');
        });

        // Ф11-6, account switch: the snapshot left over from the previous
        // session describes somebody else's lists. Dropped on every login —
        // re-seeding is silent, while a stale snapshot puts a stranger's backlog
        // on the badge.
        it('drops the airing snapshot of the previous session', async () => {
            await setAiredSnapshot({ '21': 1147 });
            stubIdentity(`${REDIRECT_URI}?code=auth-code`);
            mockLoginNetwork();

            await login();

            await expect(getLocal('airedSnapshot')).resolves.toBeUndefined();
            // The login itself succeeded — the snapshot is the only casualty.
            await expect(getLocal('auth')).resolves.toMatchObject({ user: testUser });
        });

        // The snapshot delete stands past the point of success: auth is already
        // in storage when it runs. A refused delete must not turn a live session
        // into a reported login failure — the user would be shown an error and
        // be logged in at the same time.
        it('reports the login even when the snapshot cleanup fails', async () => {
            await setAiredSnapshot({ '21': 1147 });
            stubIdentity(`${REDIRECT_URI}?code=auth-code`);
            mockLoginNetwork();
            const remove = failSnapshotRemoval();
            const consoleSpy = spyConsole();

            await expect(login()).resolves.toEqual(testUser);

            await expect(getLocal('auth')).resolves.toMatchObject({ user: testUser });
            // The stale snapshot is the price, and it is bounded: the next login
            // or logout drops it, and the badge is wrong until then — cheaper
            // than a login that says it failed while the session is live.
            await expect(getAiredSnapshot()).resolves.toEqual({ '21': 1147 });
            // Whatever the failure logged, it is not a token (CLAUDE.md rule 6).
            expect(consoleSpy.output()).not.toContain('fresh-access');
            expect(consoleSpy.output()).not.toContain('fresh-refresh');
            consoleSpy.restore();
            remove.mockRestore();
        });

        // A failed login must not touch it either: nothing changed hands, and
        // the user stays on the account they were already on.
        it('keeps the snapshot when the login fails', async () => {
            await setAiredSnapshot({ '21': 1147 });
            stubIdentity(`${REDIRECT_URI}?error=access_denied`);

            await expectApiErrorThrow(login());

            await expect(getAiredSnapshot()).resolves.toEqual({ '21': 1147 });
        });

        // The avatar reaches an <img src>, so it passes the same https guard as
        // an outbound link. A refused url is stored as '' — the state the header
        // already draws as "no avatar", never an <img> with a broken src.
        it.each(['javascript:alert(1)', 'http://cdn.test/x160.png', '//evil.test/x160.png', null])(
            'stores %s as an empty avatarUrl',
            async (avatar) => {
                stubIdentity(`${REDIRECT_URI}?code=auth-code`);
                mockLoginNetwork(avatar);

                const user = await login();

                expect(user).toEqual({ id: 7, nickname: 'tester', avatarUrl: '' });
                await expect(getLocal('auth')).resolves.toMatchObject({
                    user: { avatarUrl: '' },
                });
            },
        );

        it('requests authorization with code response type and the user_rates scope', async () => {
            let authorizeUrl = '';
            fakeBrowser.identity.getRedirectURL = (() =>
                REDIRECT_URI) as typeof fakeBrowser.identity.getRedirectURL;
            fakeBrowser.identity.launchWebAuthFlow = (async (details: { url: string }) => {
                authorizeUrl = details.url;
                return `${REDIRECT_URI}?code=auth-code`;
            }) as typeof fakeBrowser.identity.launchWebAuthFlow;
            mockLoginNetwork();

            await login();

            const parsed = new URL(authorizeUrl);
            expect(parsed.origin).toBe('https://shikimori.io');
            expect(parsed.pathname).toBe('/oauth/authorize');
            expect(parsed.searchParams.get('response_type')).toBe('code');
            expect(parsed.searchParams.get('scope')).toBe('user_rates');
            expect(parsed.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
        });

        // PKCE layer (PKCE_ENABLED in auth.ts) on top of the confidential
        // client: verifier AND secret must both reach the token endpoint.
        it('sends a matching S256 challenge/verifier pair alongside client_secret', async () => {
            let authorizeUrl = '';
            fakeBrowser.identity.getRedirectURL = (() =>
                REDIRECT_URI) as typeof fakeBrowser.identity.getRedirectURL;
            fakeBrowser.identity.launchWebAuthFlow = (async (details: { url: string }) => {
                authorizeUrl = details.url;
                return `${REDIRECT_URI}?code=auth-code`;
            }) as typeof fakeBrowser.identity.launchWebAuthFlow;
            mockLoginNetwork();

            await login();

            const authorizeQuery = new URL(authorizeUrl).searchParams;
            expect(authorizeQuery.get('code_challenge_method')).toBe('S256');

            const form = new URLSearchParams(capturedRequests()[0].body);
            expect(form.get('client_secret')).not.toBeNull();
            const verifier = form.get('code_verifier');
            expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
            // The challenge shown to the server must derive from the verifier
            // sent in the token request — otherwise the exchange is rejected.
            await expect(computeCodeChallenge(verifier ?? '')).resolves.toBe(
                authorizeQuery.get('code_challenge'),
            );
        });

        it('maps a closed authorization window to an internal error without token words', async () => {
            fakeBrowser.identity.getRedirectURL = (() =>
                REDIRECT_URI) as typeof fakeBrowser.identity.getRedirectURL;
            fakeBrowser.identity.launchWebAuthFlow = (async () => {
                throw new Error('The user did not approve access.');
            }) as typeof fakeBrowser.identity.launchWebAuthFlow;

            const error = await expectApiErrorThrow(login());
            expect(error).toEqual({ kind: 'internal', message: 'Authorization window was closed' });
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('rejects a redirect without a code', async () => {
            stubIdentity(`${REDIRECT_URI}?error=access_denied`);
            const error = await expectApiErrorThrow(login());
            expect(error).toEqual({
                kind: 'internal',
                message: 'No authorization code in redirect',
            });
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('maps an unparseable redirect URL to internal without echoing the URL', async () => {
            // A raw TypeError from new URL() would contain the full redirect
            // (with ?code=...) and leak via the dispatcher's console.debug.
            stubIdentity('not-a-valid-url?code=secret-code');
            const error = await expectApiErrorThrow(login());
            expect(error).toEqual({ kind: 'internal', message: 'Invalid redirect URL' });
            expect(JSON.stringify(error)).not.toContain('secret-code');
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('single-flight: two concurrent logins share one auth flow', async () => {
            let flowCalls = 0;
            let releaseFlow!: (url: string) => void;
            fakeBrowser.identity.getRedirectURL = (() =>
                REDIRECT_URI) as typeof fakeBrowser.identity.getRedirectURL;
            // Deferred flow: both login() calls must join before it resolves.
            fakeBrowser.identity.launchWebAuthFlow = ((): Promise<string> => {
                flowCalls += 1;
                return new Promise<string>((resolve) => {
                    releaseFlow = resolve;
                });
            }) as typeof fakeBrowser.identity.launchWebAuthFlow;
            mockLoginNetwork();

            const calls = [login(), login()];
            // Drain the event loop (bounded) until the auth window is actually
            // opened and can be released. Macrotasks, not just microtasks: the
            // PKCE crypto.subtle.digest before launchWebAuthFlow settles on one.
            for (let i = 0; i < 100 && flowCalls === 0; i++) {
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
            releaseFlow(`${REDIRECT_URI}?code=auth-code`);

            await expect(Promise.all(calls)).resolves.toEqual([testUser, testUser]);
            expect(flowCalls).toBe(1);
            // Exactly one code exchange + one whoami on the wire.
            expect(capturedRequests().map((r) => r.url)).toEqual([
                'https://shikimori.io/oauth/token',
                'https://shikimori.io/api/users/whoami',
            ]);
        });

        it('saves nothing and restores ensureToken as provider when whoami fails', async () => {
            stubIdentity(`${REDIRECT_URI}?code=auth-code`);
            fetchMock.mockImplementation(async (input) => {
                const url = String(input);
                if (url.endsWith('/oauth/token')) {
                    return jsonResponse(200, {
                        access_token: 'fresh-access',
                        refresh_token: 'fresh-refresh',
                        expires_in: 86400,
                    });
                }
                return new Response('', { status: 500 });
            });

            const error = await expectApiErrorThrow(login());
            expect(error).toMatchObject({ kind: 'api', status: 500 });
            await expect(getLocal('auth')).resolves.toBeUndefined();

            // Provider must be back to ensureToken: with empty storage the next
            // request fails with unauthorized instead of using the fresh token.
            const result = await apiRequest('/api/users/whoami');
            expect(result).toEqual({ ok: false, error: { kind: 'unauthorized' } });
        });
    });

    describe('getAuthState', () => {
        it('is anonymous on empty storage and touches no network', async () => {
            await expect(getAuthState()).resolves.toEqual({ status: 'anonymous' });
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('is authorized with the stored user and never leaks tokens', async () => {
            await setLocal('auth', storedAuth());
            const state = await getAuthState();
            expect(state).toEqual({ status: 'authorized', user: testUser });
            const wire = JSON.stringify(state);
            expect(wire).not.toContain('stored-access');
            expect(wire).not.toContain('stored-refresh');
            expect(fetchMock).not.toHaveBeenCalled();
        });
    });

    describe('logout', () => {
        it('clears auth and the whole session cache', async () => {
            await setLocal('auth', storedAuth());
            await setSession('lastTab', 'lists');

            await logout();

            await expect(getLocal('auth')).resolves.toBeUndefined();
            await expect(getSession('lastTab')).resolves.toBeUndefined();
            // Settings survive logout.
            await expect(getAuthState()).resolves.toEqual({ status: 'anonymous' });
        });

        // Ф11-6: the snapshot describes MY lists, so it goes with auth. Left
        // behind, it would make the badge count a backlog of an account that is
        // no longer logged in — and, after a login as somebody else, a stranger's.
        it('clears the airing snapshot together with auth', async () => {
            await setLocal('auth', storedAuth());
            await setAiredSnapshot({ '21': 1147 });

            await logout();

            await expect(getLocal('airedSnapshot')).resolves.toBeUndefined();
            await expect(getAiredSnapshot()).resolves.toEqual({});
        });

        // Ф11-9, ревью: the badge is wiped by clearAuth() and not by the message
        // handler, because clearAuth() is where every exit from a session meets —
        // «Выйти», the domain switch, and a refresh that lost the session in a
        // popup request. A number left on the icon has no frame on screen to
        // explain it, and restoreBadge() would redraw it on every worker start.
        it('wipes the badge together with auth', async () => {
            await setLocal('auth', storedAuth());
            await showAiredBacklog([{ rateId: '1', episodesAired: 8, progress: 3 }]);

            await logout();

            expect(await fakeBrowser.action.getBadgeText({})).toBe('');
            await expect(getLocal('badgeBacklog')).resolves.toBeUndefined();
        });

        // Ф11 audit: a notification carries the name of a title from the lists of
        // whoever was logged in, and the system centre keeps it until it is
        // dismissed by hand — it would sit there next to our icon and our name
        // for as long as the user lets it, long after the session ended.
        it('takes its notifications out of the tray together with auth', async () => {
            vi.spyOn(fakeBrowser.permissions, 'contains').mockResolvedValue(true as never);
            await setLocal('auth', storedAuth());
            await fakeBrowser.notifications.create('shikifav-aired:1', {
                type: 'basic',
                iconUrl: '/icon/128.png',
                title: 'Тайтл из списков',
                message: 'Вышла 9 серия',
            });
            await fakeBrowser.notifications.create('someone-else', {
                type: 'basic',
                iconUrl: '/icon/128.png',
                title: 'Not ours',
                message: 'x',
            });

            await logout();

            expect(Object.keys(await fakeBrowser.notifications.getAll())).toEqual(['someone-else']);
        });

        // Same rule as the snapshot delete: the badge stands past the point of
        // success, so a platform that refuses to redraw it must not cost the
        // session wipe.
        it('finishes the logout when the badge cannot be redrawn', async () => {
            await setLocal('auth', storedAuth());
            await setSession('lastTab', 'lists');
            const setBadgeText = vi
                .spyOn(fakeBrowser.action, 'setBadgeText')
                .mockRejectedValue(new Error('no action api'));
            const consoleSpy = spyConsole();

            await expect(logout()).resolves.toBeUndefined();

            await expect(getLocal('auth')).resolves.toBeUndefined();
            await expect(getSession('lastTab')).resolves.toBeUndefined();
            expect(consoleSpy.output()).not.toContain('stored-access');
            consoleSpy.restore();
            setBadgeText.mockRestore();
        });

        // The snapshot delete sits between the auth delete and the session
        // wipe. A refused delete there must not skip the wipe: the popup would
        // keep rendering the lists and the calendar of a session that is gone.
        it('finishes the logout when the snapshot cleanup fails', async () => {
            await setLocal('auth', storedAuth());
            await setSession('lastTab', 'lists');
            await setAiredSnapshot({ '21': 1147 });
            const remove = failSnapshotRemoval();
            const consoleSpy = spyConsole();

            await expect(logout()).resolves.toBeUndefined();

            await expect(getLocal('auth')).resolves.toBeUndefined();
            await expect(getSession('lastTab')).resolves.toBeUndefined();
            await expect(getAuthState()).resolves.toEqual({ status: 'anonymous' });
            expect(consoleSpy.output()).not.toContain('stored-access');
            expect(consoleSpy.output()).not.toContain('stored-refresh');
            consoleSpy.restore();
            remove.mockRestore();
        });
    });

    describe('background settings.setOrigin handler', () => {
        beforeEach(() => {
            // fake-browser has no contextMenus implementation, and
            // background.main() subscribes to onClicked synchronously.
            vi.spyOn(fakeBrowser.contextMenus.onClicked, 'addListener').mockImplementation(
                () => {},
            );
        });

        // Observable write order in storage.local: the handler is correct only
        // if 'auth' disappears before the new origin appears.
        function trackLocalKeyChanges(): string[] {
            const keys: string[] = [];
            fakeBrowser.storage.local.onChanged.addListener((changes) => {
                keys.push(...Object.keys(changes));
            });
            return keys;
        }

        it('drops auth and the session cache, then writes the new origin — in that order', async () => {
            background.main();
            await setLocal('auth', storedAuth());
            await setSession('lastTab', 'lists');
            const changedKeys = trackLocalKeyChanges();

            const response = await sendMessage('settings.setOrigin', {
                origin: 'https://shikimori.one',
            });

            expect(response).toEqual({ ok: true, data: {} });
            await expect(getLocal('auth')).resolves.toBeUndefined();
            await expect(getSession('lastTab')).resolves.toBeUndefined();
            await expect(getSettings()).resolves.toEqual({
                ...DEFAULT_SETTINGS,
                origin: 'https://shikimori.one',
            });
            // The ordering is the whole point: writing the origin first would
            // leave a window with the new domain and the old token. The airing
            // snapshot and the badge rows go out with auth (Ф11-6, Ф11-9) — they
            // were collected on the other domain, under a token that is gone.
            expect(changedKeys).toEqual(['auth', 'airedSnapshot', 'badgeBacklog', 'settings']);
            // Ending the session is storage-only — no request to either domain.
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('keeps the settings it was not asked to change', async () => {
            background.main();
            await setSettings({ origin: 'https://shikimori.io', titleLang: 'romaji' });

            await sendMessage('settings.setOrigin', { origin: 'https://shikimori.one' });

            await expect(getSettings()).resolves.toEqual({
                ...DEFAULT_SETTINGS,
                origin: 'https://shikimori.one',
                titleLang: 'romaji',
            });
        });

        // The path the review found the badge surviving on: setOrigin logs out,
        // and the number of the ended session used to stay on the icon until a
        // tick half an hour later.
        it('wipes the badge of the session it ends', async () => {
            background.main();
            await setLocal('auth', storedAuth());
            await showAiredBacklog([{ rateId: '1', episodesAired: 8, progress: 3 }]);

            await sendMessage('settings.setOrigin', { origin: 'https://shikimori.one' });

            expect(await fakeBrowser.action.getBadgeText({})).toBe('');
            await expect(getLocal('badgeBacklog')).resolves.toBeUndefined();
        });

        it('writes the origin for an anonymous user too', async () => {
            background.main();

            const response = await sendMessage('settings.setOrigin', {
                origin: 'https://shikimori.one',
            });

            expect(response).toEqual({ ok: true, data: {} });
            await expect(getSettings()).resolves.toEqual({
                ...DEFAULT_SETTINGS,
                origin: 'https://shikimori.one',
            });
        });
    });

    // Ревью Ф11-9: the badge hooks of the auth handlers were called from exactly
    // one place each and covered by nothing — deleting them left the suite green.
    // These tests go through the protocol, the way the popup does.
    describe('background auth handlers', () => {
        beforeEach(() => {
            vi.spyOn(fakeBrowser.contextMenus.onClicked, 'addListener').mockImplementation(
                () => {},
            );
        });

        // One title behind, so a tick that actually ran is readable on the icon.
        function pollAnswer(): Response {
            return jsonResponse(200, {
                data: {
                    animes: [
                        {
                            id: '1',
                            name: 'Ongoing',
                            russian: null,
                            episodesAired: 8,
                            userRate: { id: '1001', episodes: 3 },
                        },
                    ],
                },
            });
        }

        // Routes the two login requests; the airing poll is left to the caller,
        // because whether it answers at all is what each test is about.
        function mockLogin(poll: (url: string) => Promise<Response>): void {
            stubIdentity(`${REDIRECT_URI}?code=auth-code`);
            fetchMock.mockImplementation(async (input) => {
                const url = String(input);
                if (url.endsWith('/oauth/token')) {
                    return jsonResponse(200, {
                        access_token: 'fresh-access',
                        refresh_token: 'fresh-refresh',
                        expires_in: 86400,
                    });
                }
                if (url.endsWith('/api/users/whoami')) {
                    return jsonResponse(200, { id: 7, nickname: 'tester', avatar: null });
                }
                return poll(url);
            });
        }

        function badgeText(): Promise<string> {
            return fakeBrowser.action.getBadgeText({});
        }

        // The rows behind the number describe the lists of whoever was logged in
        // before, so they cannot outlive the login — even when the poll that
        // would have replaced them fails.
        it('clears the badge of the previous account on login', async () => {
            background.main();
            await showAiredBacklog([
                { rateId: '1', episodesAired: 8, progress: 3 },
                { rateId: '2', episodesAired: 4, progress: 1 },
            ]);
            mockLogin(async () => {
                throw new TypeError('offline');
            });

            await expect(sendMessage('auth.login')).resolves.toMatchObject({ ok: true });

            expect(await badgeText()).toBe('');
            await expect(getLocal('badgeBacklog')).resolves.toBeUndefined();
        });

        // The counter must not wait for the next alarm — up to half an hour — to
        // appear for the account that just logged in.
        it('polls for the account that just logged in', async () => {
            background.main();
            mockLogin(async () => pollAnswer());

            await sendMessage('auth.login');

            await vi.waitFor(async () => expect(await badgeText()).toBe('1'));
        });

        // A tick started under the previous session must not stand in for the
        // new one: single-flight would hand its promise back and the new account
        // would go unpolled until the next alarm.
        it('polls again even with a tick of the previous session in flight', async () => {
            background.main();
            await setLocal('auth', storedAuth());
            let releaseStalePoll: (response: Response) => void = () => {};
            let polls = 0;
            mockLogin(async () => {
                polls += 1;
                if (polls === 1) {
                    return new Promise<Response>((resolve) => {
                        releaseStalePoll = resolve;
                    });
                }
                return pollAnswer();
            });
            const stale = runEpisodeWatchTick();
            await vi.waitFor(() => expect(polls).toBe(1));

            await sendMessage('auth.login');

            await vi.waitFor(() => expect(polls).toBe(2));
            releaseStalePoll(pollAnswer());
            await stale;
        });

        // Ф11-10, the session epoch. A poll cannot be cancelled, and it can live
        // for minutes (a 429 is retried inside http.ts). What lands after the
        // session it belongs to has ended must write NOTHING — otherwise the
        // stale answer re-seeds the snapshot of the account that just left, the
        // icon keeps its number, and restoreBadge() redraws it on every worker
        // start.
        it('writes nothing for a tick that lands after a login', async () => {
            background.main();
            // The permission is granted, so a stale increase WOULD reach the
            // screen if the fence were missing — this is the account-switch case
            // the fence exists for.
            vi.spyOn(fakeBrowser.permissions, 'contains').mockResolvedValue(true as never);
            await setLocal('auth', storedAuth());
            let releaseStalePoll: (response: Response) => void = () => {};
            let polls = 0;
            mockLogin(async () => {
                polls += 1;
                if (polls === 1) {
                    return new Promise<Response>((resolve) => {
                        releaseStalePoll = resolve;
                    });
                }
                return pollAnswer();
            });
            const stale = runEpisodeWatchTick();
            await vi.waitFor(() => expect(polls).toBe(1));

            await sendMessage('auth.login');
            await vi.waitFor(async () => expect(await badgeText()).toBe('1'));

            // The stale answer says the same title is four episodes further
            // along: against the snapshot of the NEW session that is an increase,
            // i.e. a notification about somebody else's lists.
            releaseStalePoll(
                jsonResponse(200, {
                    data: {
                        animes: [
                            {
                                id: '1',
                                name: 'Ongoing',
                                russian: null,
                                episodesAired: 12,
                                userRate: { id: '1001', episodes: 3 },
                            },
                        ],
                    },
                }),
            );
            await stale;

            // Everything on screen and in storage belongs to the new session.
            await expect(getAiredSnapshot()).resolves.toEqual({ '1': 8 });
            expect(await badgeText()).toBe('1');
            await expect(fakeBrowser.notifications.getAll()).resolves.toEqual({});
        });

        it('writes nothing for a tick that lands after a logout', async () => {
            background.main();
            await setLocal('auth', storedAuth());
            let releaseStalePoll: (response: Response) => void = () => {};
            stubIdentity(`${REDIRECT_URI}?code=auth-code`);
            fetchMock.mockImplementation(
                async () =>
                    new Promise<Response>((resolve) => {
                        releaseStalePoll = resolve;
                    }),
            );
            const stale = runEpisodeWatchTick();
            await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

            await sendMessage('auth.logout');
            releaseStalePoll(pollAnswer());
            await stale;

            // A number on the icon and list data in storage, both belonging to a
            // session that no longer exists — exactly what the phase forbids.
            expect(await badgeText()).toBe('');
            await expect(getLocal('badgeBacklog')).resolves.toBeUndefined();
            await expect(getLocal('airedSnapshot')).resolves.toBeUndefined();
        });

        // Нит ревью: the comment claimed «FIRST, before anything else here»
        // while the bump stood second, after the auth removal. The order is not
        // cosmetic — a storage backend may take as long as it likes, and
        // everything landing DURING the removal must already be fenced. This is
        // that statement, and it is what makes the comment checkable.
        it('moves the session epoch before the auth removal, not after it', async () => {
            await setLocal('auth', storedAuth());
            const epoch = sessionEpoch();
            const realRemove = fakeBrowser.storage.local.remove.bind(fakeBrowser.storage.local);
            let currentInsideRemove: boolean | undefined;
            vi.spyOn(fakeBrowser.storage.local, 'remove').mockImplementation((async (
                keys: string | string[],
            ) => {
                if (currentInsideRemove === undefined && [keys].flat().includes('auth')) {
                    currentInsideRemove = isSessionEpochCurrent(epoch);
                }
                return realRemove(keys);
            }) as never);

            await logout();

            expect(currentInsideRemove).toBe(false);
        });

        it('wipes the badge on auth.logout', async () => {
            background.main();
            await setLocal('auth', storedAuth());
            await showAiredBacklog([{ rateId: '1', episodesAired: 8, progress: 3 }]);

            await expect(sendMessage('auth.logout')).resolves.toEqual({ ok: true, data: {} });

            expect(await badgeText()).toBe('');
            await expect(getLocal('badgeBacklog')).resolves.toBeUndefined();
        });
    });

    describe('secret hygiene', () => {
        // CLAUDE.md rule 6 / docs/04 §6: tokens and client_secret never reach
        // the console — both the success and the failure refresh paths log.
        it('keeps tokens and the client secret out of the console during refresh', async () => {
            const consoleSpy = spyConsole();
            try {
                await setLocal('auth', storedAuth({ expiresAt: Date.now() - 1000 }));
                fetchMock.mockResolvedValueOnce(
                    jsonResponse(200, {
                        access_token: 'new-access',
                        refresh_token: 'new-refresh',
                        expires_in: 86400,
                    }),
                );
                await ensureToken();

                // Failure path: reset to an expired token and let refresh die.
                await setLocal('auth', storedAuth({ expiresAt: Date.now() - 1000 }));
                fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: 'invalid_grant' }));
                await expectApiErrorThrow(ensureToken());

                const output = consoleSpy.output();
                for (const secret of [
                    'stored-access',
                    'stored-refresh',
                    'new-access',
                    'new-refresh',
                    'client_secret',
                    'Bearer',
                ]) {
                    expect(output).not.toContain(secret);
                }
            } finally {
                consoleSpy.restore();
            }
        });

        it('keeps tokens out of the console during the 401-retry flow', async () => {
            const consoleSpy = spyConsole();
            try {
                await setLocal('auth', storedAuth());
                fetchMock
                    .mockResolvedValueOnce(new Response('', { status: 401 }))
                    .mockResolvedValueOnce(
                        jsonResponse(200, {
                            access_token: 'new-access',
                            refresh_token: 'new-refresh',
                            expires_in: 86400,
                        }),
                    )
                    .mockResolvedValueOnce(jsonResponse(200, { id: 7 }));

                await authorizedRequest('/api/users/whoami');

                const output = consoleSpy.output();
                for (const secret of [
                    'stored-access',
                    'stored-refresh',
                    'new-access',
                    'new-refresh',
                    'client_secret',
                    'Bearer',
                ]) {
                    expect(output).not.toContain(secret);
                }
            } finally {
                consoleSpy.restore();
            }
        });
    });
});
