import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { getLocal, getSession, setLocal, setSession } from '../storage';
import type { LocalState } from '../storage';
import {
    authorizedRequest,
    computeExpiresAt,
    ensureToken,
    forceRefresh,
    getAuthState,
    login,
    logout,
} from './auth';
import { apiRequest, setTokenProvider } from './http';
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

describe('auth', () => {
    beforeEach(() => {
        fakeBrowser.reset();
        fetchMock.mockReset();
        vi.stubGlobal('fetch', fetchMock);
        // Mirrors the registration in entrypoints/background.ts.
        setTokenProvider(ensureToken);
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
            expect(computeExpiresAt(86400, undefined, nowMs)).toBe(
                (5_000_000 + 86400 - 60) * 1000,
            );
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
            expect(request.url).toBe('https://shikimori.one/oauth/token');
            const form = new URLSearchParams(request.body);
            expect(form.get('grant_type')).toBe('refresh_token');
            expect(form.get('refresh_token')).toBe('stored-refresh');
            expect(form.get('client_id')).not.toBeNull();
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
                'https://shikimori.one/api/users/whoami',
                'https://shikimori.one/oauth/token',
                'https://shikimori.one/api/users/whoami',
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
        function mockLoginNetwork(): void {
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
                    return jsonResponse(200, {
                        id: 7,
                        nickname: 'tester',
                        avatar: 'https://cdn.test/x160.png',
                    });
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
            expect(exchange.url).toBe('https://shikimori.one/oauth/token');
            const form = new URLSearchParams(exchange.body);
            expect(form.get('grant_type')).toBe('authorization_code');
            expect(form.get('code')).toBe('auth-code');
            expect(form.get('redirect_uri')).toBe(REDIRECT_URI);
            // whoami runs with the fresh token before auth reaches storage.
            expect(whoami.url).toBe('https://shikimori.one/api/users/whoami');
            expect(whoami.headers['Authorization']).toBe('Bearer fresh-access');
        });

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
            expect(parsed.origin).toBe('https://shikimori.one');
            expect(parsed.pathname).toBe('/oauth/authorize');
            expect(parsed.searchParams.get('response_type')).toBe('code');
            expect(parsed.searchParams.get('scope')).toBe('user_rates');
            expect(parsed.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
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
            // Drain microtasks (bounded, no real timers) until the auth window
            // is actually opened and can be released.
            for (let i = 0; i < 100 && flowCalls === 0; i++) {
                await Promise.resolve();
            }
            releaseFlow(`${REDIRECT_URI}?code=auth-code`);

            await expect(Promise.all(calls)).resolves.toEqual([testUser, testUser]);
            expect(flowCalls).toBe(1);
            // Exactly one code exchange + one whoami on the wire.
            expect(capturedRequests().map((r) => r.url)).toEqual([
                'https://shikimori.one/oauth/token',
                'https://shikimori.one/api/users/whoami',
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
