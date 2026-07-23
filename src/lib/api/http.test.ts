import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { APP_NAME } from '../config';
import { setLocal } from '../storage';
import { apiRequest, oauthRequest, rateLimiter, setTokenProvider } from './http';
import type { HttpResult } from './http';
import type { ApiError } from './types';

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
    return new Response(JSON.stringify(body), { status, headers });
}

function expectFail<T>(result: HttpResult<T>): ApiError {
    if (result.ok) {
        throw new Error('Expected a failed result');
    }
    return result.error;
}

function lastRequest(): { url: string; init: RequestInit & { headers: Record<string, string> } } {
    const call = fetchMock.mock.calls.at(-1);
    if (!call) {
        throw new Error('fetch was not called');
    }
    const [input, init] = call;
    return { url: String(input), init: init as RequestInit & { headers: Record<string, string> } };
}

describe('http', () => {
    beforeEach(() => {
        fakeBrowser.reset();
        fetchMock.mockReset();
        vi.stubGlobal('fetch', fetchMock);
        setTokenProvider(async () => 'test-token');
        // Fresh sliding window: requests from earlier tests must not delay
        // this one (the limiter is module-level state in http.ts).
        rateLimiter.reset();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    describe('APP_NAME guard', () => {
        it('fails fast with internal when APP_NAME is empty, without fetching', async () => {
            // Fresh module graph so config.ts re-reads the stubbed env.
            vi.stubEnv('WXT_SHIKI_APP_NAME', '');
            vi.resetModules();
            const freshHttp = await import('./http');
            const result = await freshHttp.oauthRequest('/oauth/token', { grant_type: 'x' });
            expect(expectFail(result)).toEqual({
                kind: 'internal',
                message: 'APP_NAME is not configured',
            });
            expect(fetchMock).not.toHaveBeenCalled();
        });
    });

    describe('error mapping', () => {
        it('maps a fetch failure to network', async () => {
            fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
            const result = await apiRequest('/api/users/whoami');
            expect(expectFail(result)).toEqual({ kind: 'network' });
        });

        it('maps 401 to unauthorized', async () => {
            fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }));
            const result = await apiRequest('/api/users/whoami');
            expect(expectFail(result)).toEqual({ kind: 'unauthorized' });
        });

        it('maps 429 with Retry-After to rate_limited with retryAfterMs', async () => {
            fetchMock.mockResolvedValueOnce(
                new Response('', { status: 429, headers: { 'Retry-After': '3' } }),
            );
            const result = await apiRequest('/api/graphql', { method: 'POST', body: {} });
            expect(expectFail(result)).toEqual({ kind: 'rate_limited', retryAfterMs: 3000 });
        });

        it('maps 429 without Retry-After to rate_limited without retryAfterMs', async () => {
            fetchMock.mockResolvedValueOnce(new Response('', { status: 429 }));
            // retryOn429 off: this test checks mapping, not the backoff.
            const result = await apiRequest('/api/graphql', { retryOn429: false });
            expect(expectFail(result)).toEqual({ kind: 'rate_limited' });
        });

        it('maps 429 with an unparseable Retry-After to rate_limited without retryAfterMs', async () => {
            fetchMock.mockResolvedValueOnce(
                new Response('', { status: 429, headers: { 'Retry-After': 'soon' } }),
            );
            const result = await apiRequest('/api/graphql', { retryOn429: false });
            expect(expectFail(result)).toEqual({ kind: 'rate_limited' });
        });

        it('maps 429 with a blank Retry-After to rate_limited without retryAfterMs', async () => {
            // Number('') === 0: a blank header must not read as "retry now".
            fetchMock.mockResolvedValueOnce(
                new Response('', { status: 429, headers: { 'Retry-After': '' } }),
            );
            const result = await apiRequest('/api/graphql', { retryOn429: false });
            expect(expectFail(result)).toEqual({ kind: 'rate_limited' });
        });

        it('maps 422 with a REST validation array to api with a joined message', async () => {
            fetchMock.mockResolvedValueOnce(
                jsonResponse(422, ['Episodes is invalid', 'Score is not included in the list']),
            );
            const result = await apiRequest('/api/v2/user_rates/1', { method: 'PATCH', body: {} });
            expect(expectFail(result)).toEqual({
                kind: 'api',
                status: 422,
                message: 'Episodes is invalid; Score is not included in the list',
            });
        });

        it('maps 400 with an oauth error body to api with error_description', async () => {
            fetchMock.mockResolvedValueOnce(
                jsonResponse(400, {
                    error: 'invalid_grant',
                    error_description: 'The provided authorization grant is invalid',
                }),
            );
            const result = await oauthRequest('/oauth/token', { grant_type: 'refresh_token' });
            expect(expectFail(result)).toEqual({
                kind: 'api',
                status: 400,
                message: 'The provided authorization grant is invalid',
            });
        });

        it.each([403, 404])('maps %i to api with the status preserved', async (status) => {
            fetchMock.mockResolvedValueOnce(jsonResponse(status, { message: 'Access is denied' }));
            const result = await apiRequest('/api/users/whoami');
            expect(expectFail(result)).toEqual({
                kind: 'api',
                status,
                message: 'Access is denied',
            });
        });

        it('maps 500 with a non-JSON body to api with the raw text', async () => {
            fetchMock.mockResolvedValueOnce(
                new Response('<html>Server error</html>', { status: 500 }),
            );
            const result = await apiRequest('/api/graphql');
            expect(expectFail(result)).toEqual({
                kind: 'api',
                status: 500,
                message: '<html>Server error</html>',
            });
        });

        it('truncates overly long error bodies', async () => {
            fetchMock.mockResolvedValueOnce(new Response('x'.repeat(1000), { status: 503 }));
            const result = await apiRequest('/api/graphql');
            const error = expectFail(result);
            expect(error.kind).toBe('api');
            if (error.kind === 'api') {
                expect(error.message).toHaveLength(200);
            }
        });

        it('maps invalid JSON in a 200 response to internal', async () => {
            fetchMock.mockResolvedValueOnce(new Response('not json', { status: 200 }));
            const result = await apiRequest('/api/users/whoami');
            expect(expectFail(result)).toEqual({
                kind: 'internal',
                message: 'Invalid JSON in response body',
            });
        });
    });

    describe('success responses', () => {
        it('returns parsed JSON on 200', async () => {
            fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 42, nickname: 'tester' }));
            const result = await apiRequest<{ id: number; nickname: string }>('/api/users/whoami');
            expect(result).toEqual({ ok: true, data: { id: 42, nickname: 'tester' } });
        });

        it('returns undefined data on 204', async () => {
            fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
            const result = await apiRequest<undefined>('/api/v2/user_rates/1', {
                method: 'DELETE',
            });
            expect(result).toEqual({ ok: true, data: undefined });
        });
    });

    describe('headers and body', () => {
        it('apiRequest sends User-Agent, Bearer token and JSON body', async () => {
            fetchMock.mockResolvedValueOnce(jsonResponse(201, {}));
            await apiRequest('/api/v2/user_rates', {
                method: 'POST',
                body: { user_rate: { target_id: 1 } },
            });
            const { init } = lastRequest();
            expect(init.method).toBe('POST');
            expect(init.headers['User-Agent']).toBe(APP_NAME);
            expect(init.headers['Authorization']).toBe('Bearer test-token');
            expect(init.headers['Content-Type']).toBe('application/json');
            expect(init.body).toBe(JSON.stringify({ user_rate: { target_id: 1 } }));
        });

        it('apiRequest defaults to GET without Content-Type when there is no body', async () => {
            fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
            await apiRequest('/api/users/whoami');
            const { init } = lastRequest();
            expect(init.method).toBe('GET');
            expect(init.headers['Content-Type']).toBeUndefined();
            expect(init.body).toBeUndefined();
        });

        it('oauthRequest sends a form-urlencoded body without Authorization', async () => {
            fetchMock.mockResolvedValueOnce(jsonResponse(200, { access_token: 'x' }));
            await oauthRequest('/oauth/token', { grant_type: 'authorization_code', code: 'abc' });
            const { init } = lastRequest();
            expect(init.method).toBe('POST');
            expect(init.headers['User-Agent']).toBe(APP_NAME);
            expect(init.headers['Authorization']).toBeUndefined();
            expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
            expect(init.body).toBe('grant_type=authorization_code&code=abc');
        });
    });

    describe('origin', () => {
        it('uses the default origin when settings are absent', async () => {
            fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
            await apiRequest('/api/users/whoami');
            expect(lastRequest().url).toBe('https://shikimori.io/api/users/whoami');
        });

        it('re-reads the origin from storage on every request', async () => {
            fetchMock.mockResolvedValue(jsonResponse(200, {}));
            await apiRequest('/api/users/whoami');
            expect(lastRequest().url).toBe('https://shikimori.io/api/users/whoami');

            await setLocal('settings', { origin: 'https://shikimori.one', titleLang: 'ru' });
            await apiRequest('/api/users/whoami');
            expect(lastRequest().url).toBe('https://shikimori.one/api/users/whoami');
        });
    });

    describe('429 backoff', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        function rateLimitedResponse(retryAfterSeconds?: number): Response {
            return new Response('', {
                status: 429,
                headers:
                    retryAfterSeconds === undefined
                        ? undefined
                        : { 'Retry-After': String(retryAfterSeconds) },
            });
        }

        it('retries a GET after the Retry-After delay and succeeds', async () => {
            fetchMock
                .mockResolvedValueOnce(rateLimitedResponse(3))
                .mockResolvedValueOnce(jsonResponse(200, { id: 1 }));

            const promise = apiRequest<{ id: number }>('/api/users/whoami');
            await vi.advanceTimersByTimeAsync(0);
            expect(fetchMock).toHaveBeenCalledTimes(1);

            await vi.advanceTimersByTimeAsync(2999);
            expect(fetchMock).toHaveBeenCalledTimes(1);

            await vi.advanceTimersByTimeAsync(1);
            expect(fetchMock).toHaveBeenCalledTimes(2);
            await expect(promise).resolves.toEqual({ ok: true, data: { id: 1 } });
        });

        it('caps an anomalous Retry-After at 60 seconds', async () => {
            fetchMock
                .mockResolvedValueOnce(rateLimitedResponse(3600))
                .mockResolvedValueOnce(jsonResponse(200, { id: 1 }));

            const promise = apiRequest<{ id: number }>('/api/users/whoami');
            await vi.advanceTimersByTimeAsync(59_999);
            expect(fetchMock).toHaveBeenCalledTimes(1);

            await vi.advanceTimersByTimeAsync(1);
            expect(fetchMock).toHaveBeenCalledTimes(2);
            await expect(promise).resolves.toEqual({ ok: true, data: { id: 1 } });
        });

        it('backs off 2s -> 4s -> 8s without Retry-After and fails after 3 retries', async () => {
            fetchMock.mockImplementation(async () => rateLimitedResponse());

            const promise = apiRequest('/api/users/whoami');
            await vi.advanceTimersByTimeAsync(0);
            expect(fetchMock).toHaveBeenCalledTimes(1);

            await vi.advanceTimersByTimeAsync(2000);
            expect(fetchMock).toHaveBeenCalledTimes(2);

            await vi.advanceTimersByTimeAsync(4000);
            expect(fetchMock).toHaveBeenCalledTimes(3);

            await vi.advanceTimersByTimeAsync(8000);
            expect(fetchMock).toHaveBeenCalledTimes(4);

            // Retries exhausted: the last rate_limited error surfaces as is,
            // and no further timers are pending.
            await expect(promise).resolves.toEqual({
                ok: false,
                error: { kind: 'rate_limited' },
            });
            await vi.runAllTimersAsync();
            expect(fetchMock).toHaveBeenCalledTimes(4);
        });

        it('does not retry non-GET methods by default', async () => {
            fetchMock.mockResolvedValueOnce(rateLimitedResponse(3));
            const promise = apiRequest('/api/v2/user_rates', { method: 'POST', body: {} });
            await vi.advanceTimersByTimeAsync(0);
            await expect(promise).resolves.toEqual({
                ok: false,
                error: { kind: 'rate_limited', retryAfterMs: 3000 },
            });
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it('does not retry a GET when retryOn429 is disabled', async () => {
            fetchMock.mockResolvedValueOnce(rateLimitedResponse());
            const promise = apiRequest('/api/graphql', { retryOn429: false });
            await vi.advanceTimersByTimeAsync(0);
            await expect(promise).resolves.toEqual({
                ok: false,
                error: { kind: 'rate_limited' },
            });
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it('lets POST opt into retries via retryOn429 (GraphQL reads)', async () => {
            fetchMock
                .mockResolvedValueOnce(rateLimitedResponse(1))
                .mockResolvedValueOnce(jsonResponse(200, { data: {} }));

            const promise = apiRequest('/api/graphql', {
                method: 'POST',
                body: {},
                retryOn429: true,
            });
            await vi.advanceTimersByTimeAsync(1000);
            expect(fetchMock).toHaveBeenCalledTimes(2);
            await expect(promise).resolves.toEqual({ ok: true, data: { data: {} } });
        });

        it('never retries oauth requests on 429', async () => {
            fetchMock.mockResolvedValueOnce(rateLimitedResponse(2));
            const promise = oauthRequest('/oauth/token', { grant_type: 'refresh_token' });
            await vi.advanceTimersByTimeAsync(0);
            await expect(promise).resolves.toEqual({
                ok: false,
                error: { kind: 'rate_limited', retryAfterMs: 2000 },
            });
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it('sends the retry through the limiter queue behind waiting requests', async () => {
            let graphqlCalls = 0;
            fetchMock.mockImplementation(async (input) => {
                if (String(input).includes('/api/graphql')) {
                    graphqlCalls += 1;
                    return graphqlCalls === 1 ? rateLimitedResponse(1) : jsonResponse(200, {});
                }
                return jsonResponse(200, {});
            });

            const retried = apiRequest('/api/graphql'); // GET: retryOn429 by default
            const background = Array.from({ length: 7 }, () => apiRequest('/api/users/whoami'));

            await vi.advanceTimersByTimeAsync(0);
            // t=0: the 429'd request plus 3 background fill the 4 rps window.
            expect(fetchMock).toHaveBeenCalledTimes(4);

            await vi.advanceTimersByTimeAsync(1000);
            // t=1s: the remaining 4 background take the freed window; the
            // retry (due exactly now per Retry-After) queues behind them
            // instead of bypassing the limiter.
            expect(fetchMock).toHaveBeenCalledTimes(8);
            expect(graphqlCalls).toBe(1);

            await vi.advanceTimersByTimeAsync(1000);
            // t=2s: the retry finally gets a slot.
            expect(graphqlCalls).toBe(2);
            await expect(retried).resolves.toEqual({ ok: true, data: {} });
            await Promise.all(background);
        });
    });

    describe('token provider', () => {
        it('fails with internal when no provider is registered', async () => {
            // Fresh module instance: the shared one gets a provider in beforeEach.
            vi.resetModules();
            const freshHttp = await import('./http');
            const result = await freshHttp.apiRequest('/api/users/whoami');
            expect(expectFail(result)).toEqual({
                kind: 'internal',
                message: 'Token provider is not registered',
            });
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('passes an ApiError thrown by the provider through unchanged', async () => {
            setTokenProvider(async () => {
                throw { kind: 'network' } satisfies ApiError;
            });
            const result = await apiRequest('/api/users/whoami');
            expect(expectFail(result)).toEqual({ kind: 'network' });
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('maps a non-ApiError provider failure to unauthorized', async () => {
            setTokenProvider(async () => {
                throw new Error('no refresh token');
            });
            const result = await apiRequest('/api/users/whoami');
            expect(expectFail(result)).toEqual({ kind: 'unauthorized' });
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('oauthRequest works without any token provider', async () => {
            vi.resetModules();
            const freshHttp = await import('./http');
            fetchMock.mockResolvedValueOnce(jsonResponse(200, { access_token: 'x' }));
            const result = await freshHttp.oauthRequest('/oauth/token', { grant_type: 'x' });
            expect(result.ok).toBe(true);
        });
    });
});
