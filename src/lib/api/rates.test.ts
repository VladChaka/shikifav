import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import background from '@/entrypoints/background';
import { sendMessage } from '../messaging';
import { setLocal } from '../storage';
import type { LocalState } from '../storage';
import { createRate, deleteRate, incrementRate, updateRate } from './rates';
import { ensureToken } from './auth';
import { rateLimiter, setTokenProvider } from './http';
import type { ApiError, User } from './types';

const fetchMock = vi.fn<typeof fetch>();

const testUser: User = { id: 7, nickname: 'tester', avatarUrl: 'https://cdn.test/x160.png' };

function storedAuth(): NonNullable<LocalState['auth']> {
    return {
        accessToken: 'stored-access',
        refreshToken: 'stored-refresh',
        expiresAt: Date.now() + 60 * 60 * 1000,
        user: testUser,
    };
}

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status });
}

interface CapturedRequest {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: unknown;
}

function capturedRequests(): CapturedRequest[] {
    return fetchMock.mock.calls.map(([input, init]) => ({
        url: String(input),
        method: init?.method ?? 'GET',
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
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

describe('rates', () => {
    beforeEach(() => {
        fakeBrowser.reset();
        fetchMock.mockReset();
        vi.stubGlobal('fetch', fetchMock);
        // Mirrors the registration in entrypoints/background.ts.
        setTokenProvider(ensureToken);
        // Fresh sliding window: leftover timestamps would delay this test.
        rateLimiter.reset();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe('createRate', () => {
        it('POSTs user_rate with user_id from storage and a numeric target_id', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(
                jsonResponse(201, { id: 42, status: 'planned', episodes: 0, score: 0 }),
            );

            await expect(createRate('52991', 'Anime', 'planned')).resolves.toEqual({
                id: '42',
                status: 'planned',
            });

            const request = capturedRequests()[0];
            expect(request.url).toBe('https://shikimori.io/api/v2/user_rates');
            expect(request.method).toBe('POST');
            expect(request.headers['Authorization']).toBe('Bearer stored-access');
            // target_id must be the number 52991, not the string '52991'
            // (GraphQL ID is a string, REST expects a number — docs/03).
            expect(request.body).toEqual({
                user_rate: {
                    user_id: 7,
                    target_id: 52991,
                    target_type: 'Anime',
                    status: 'planned',
                },
            });
        });

        it('fails fast with internal on a non-numeric targetId without touching the network', async () => {
            await setLocal('auth', storedAuth());

            const error = await expectApiErrorThrow(createRate('not-an-id', 'Anime', 'planned'));
            expect(error).toEqual({
                kind: 'internal',
                message: 'Non-numeric target id: "not-an-id"',
            });
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('throws unauthorized without touching the network when there is no auth', async () => {
            const error = await expectApiErrorThrow(createRate('52991', 'Anime', 'planned'));
            expect(error).toEqual({ kind: 'unauthorized' });
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('does not auto-retry a write on 429', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(
                new Response('', { status: 429, headers: { 'Retry-After': '0' } }),
            );

            const error = await expectApiErrorThrow(createRate('52991', 'Anime', 'planned'));
            expect(error).toEqual({ kind: 'rate_limited', retryAfterMs: 0 });
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });
    });

    describe('updateRate', () => {
        it('PATCHes only the given fields and maps the response to RateState', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(
                jsonResponse(200, {
                    id: 42,
                    status: 'watching',
                    score: 0,
                    episodes: 5,
                    chapters: 0,
                    volumes: 0,
                }),
            );

            await expect(updateRate('42', { status: 'watching' })).resolves.toEqual({
                id: '42',
                status: 'watching',
                score: 0,
                episodes: 5,
                chapters: 0,
                volumes: 0,
            });

            const request = capturedRequests()[0];
            expect(request.url).toBe('https://shikimori.io/api/v2/user_rates/42');
            expect(request.method).toBe('PATCH');
            // Partial body: absent patch fields must not reach the wire.
            expect(request.body).toEqual({ user_rate: { status: 'watching' } });
        });

        it('PATCHes a score with {user_rate: {score: N}} on the wire', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(
                jsonResponse(200, {
                    id: 42,
                    status: 'watching',
                    score: 8,
                    episodes: 5,
                    chapters: 0,
                    volumes: 0,
                }),
            );

            const state = await updateRate('42', { score: 8 });
            expect(state.score).toBe(8);
            expect(capturedRequests()[0].body).toEqual({ user_rate: { score: 8 } });
        });

        it('keeps score: 0 (remove the score) in the PATCH body', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(
                jsonResponse(200, {
                    id: 42,
                    status: 'watching',
                    score: 0,
                    episodes: 5,
                    chapters: 0,
                    volumes: 0,
                }),
            );

            const state = await updateRate('42', { score: 0 });
            expect(state.score).toBe(0);
            // 0 is falsy but must reach the wire — it is the "remove score" value.
            expect(capturedRequests()[0].body).toEqual({ user_rate: { score: 0 } });
        });

        it('passes a 404 through as is (record deleted on the site)', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(jsonResponse(404, { message: 'Not Found' }));

            const error = await expectApiErrorThrow(updateRate('42', { score: 8 }));
            expect(error).toEqual({ kind: 'api', status: 404, message: 'Not Found' });
        });
    });

    describe('incrementRate', () => {
        it('POSTs to /increment without a body and maps the response to RateState', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(
                jsonResponse(201, {
                    id: 42,
                    status: 'watching',
                    score: 7,
                    episodes: 6,
                    chapters: 0,
                    volumes: 0,
                }),
            );

            await expect(incrementRate('42')).resolves.toEqual({
                id: '42',
                status: 'watching',
                score: 7,
                episodes: 6,
                chapters: 0,
                volumes: 0,
            });

            const request = capturedRequests()[0];
            expect(request.url).toBe('https://shikimori.io/api/v2/user_rates/42/increment');
            expect(request.method).toBe('POST');
            expect(request.headers['Authorization']).toBe('Bearer stored-access');
            expect(request.body).toBeUndefined();
        });

        it('does not auto-retry on 429: a duplicate increment would corrupt progress', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(
                new Response('', { status: 429, headers: { 'Retry-After': '0' } }),
            );

            const error = await expectApiErrorThrow(incrementRate('42'));
            expect(error).toEqual({ kind: 'rate_limited', retryAfterMs: 0 });
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it('passes a 404 through as is (record deleted on the site)', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(jsonResponse(404, { message: 'Not Found' }));

            const error = await expectApiErrorThrow(incrementRate('42'));
            expect(error).toEqual({ kind: 'api', status: 404, message: 'Not Found' });
        });
    });

    describe('deleteRate', () => {
        it('DELETEs the rate and resolves on 204 without a body', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

            await expect(deleteRate('42')).resolves.toBeUndefined();

            const request = capturedRequests()[0];
            expect(request.url).toBe('https://shikimori.io/api/v2/user_rates/42');
            expect(request.method).toBe('DELETE');
            expect(request.body).toBeUndefined();
        });

        it('passes a 404 through as is', async () => {
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(jsonResponse(404, { message: 'Not Found' }));

            const error = await expectApiErrorThrow(deleteRate('42'));
            expect(error).toEqual({ kind: 'api', status: 404, message: 'Not Found' });
        });
    });

    describe('background rates handlers', () => {
        it('rates.create responds with the created rate over messaging', async () => {
            background.main();
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(jsonResponse(201, { id: 42, status: 'planned' }));

            const response = await sendMessage('rates.create', {
                targetId: '52991',
                targetType: 'Anime',
                status: 'planned',
            });
            expect(response).toEqual({
                ok: true,
                data: { rate: { id: '42', status: 'planned' } },
            });
            // The payload has no user_id — background takes it from storage.
            const body = capturedRequests()[0].body as {
                user_rate: Record<string, unknown>;
            };
            expect(body.user_rate.user_id).toBe(7);
        });

        it('rates.create keeps the unauthorized kind on the wire when there is no auth', async () => {
            background.main();

            const response = await sendMessage('rates.create', {
                targetId: '52991',
                targetType: 'Anime',
                status: 'planned',
            });
            expect(response).toEqual({ ok: false, error: { kind: 'unauthorized' } });
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('rates.update responds with the updated rate over messaging', async () => {
            background.main();
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 42, status: 'completed' }));

            const response = await sendMessage('rates.update', {
                rateId: '42',
                patch: { status: 'completed', score: 9 },
            });
            expect(response).toEqual({
                ok: true,
                data: { rate: { id: '42', status: 'completed' } },
            });
        });

        it('rates.delete responds with an empty data object over messaging', async () => {
            background.main();
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

            const response = await sendMessage('rates.delete', { rateId: '42' });
            expect(response).toEqual({ ok: true, data: {} });
        });

        it('rates.increment responds with the full RateState over messaging', async () => {
            background.main();
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(
                jsonResponse(201, {
                    id: 42,
                    status: 'watching',
                    score: 7,
                    episodes: 6,
                    chapters: 0,
                    volumes: 0,
                }),
            );

            const response = await sendMessage('rates.increment', { rateId: '42' });
            expect(response).toEqual({
                ok: true,
                data: {
                    rate: {
                        id: '42',
                        status: 'watching',
                        score: 7,
                        episodes: 6,
                        chapters: 0,
                        volumes: 0,
                    },
                },
            });
        });

        it('rates.increment keeps the ApiError kind on the wire on a 404', async () => {
            background.main();
            await setLocal('auth', storedAuth());
            fetchMock.mockResolvedValueOnce(jsonResponse(404, { message: 'Not Found' }));

            const response = await sendMessage('rates.increment', { rateId: '42' });
            expect(response).toEqual({
                ok: false,
                error: { kind: 'api', status: 404, message: 'Not Found' },
            });
        });
    });
});
