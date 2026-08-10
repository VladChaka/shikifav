import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { onMessage, sendMessage } from './messaging';
import type { MessageHandlers, MessageResponse, MessageType } from './messaging';
import type { ApiError, RateTargetType, RelatedItem, User } from './api/types';
import type { Origin } from './config';

// fake-browser invokes onMessage listeners without sendResponse, so these tests
// exercise the promise-return branch of the listener; the sendResponse+return true
// branch is Chrome-only and stays on the manual smoke checklist.

const testUser: User = { id: 1, nickname: 'tester', avatarUrl: 'https://example.com/a.png' };

// One row of the related screen, spelled out once: the point of the round-trip
// below is that the envelope carries the wrapper whole, relation and card alike.
const relatedItem: RelatedItem = {
    relationKind: 'sequel',
    relationText: 'Продолжение',
    card: {
        id: '2',
        targetType: 'Anime',
        name: 'Sequel',
        russian: null,
        kind: 'tv',
        score: null,
        status: null,
        year: 2011,
        posterUrl: null,
        posterUrl2x: null,
        userRate: null,
    },
};

// MessageHandlers is exhaustive over MessageMap, so every registration needs the
// full set; tests override only the handler under test.
function makeHandlers(overrides: Partial<MessageHandlers> = {}): MessageHandlers {
    return {
        ping: async () => ({ pong: true }),
        'auth.getState': async () => ({ status: 'anonymous' }),
        'auth.login': async () => ({ user: testUser }),
        'auth.logout': async () => ({}),
        'search.titles': async () => ({ items: [] }),
        'rates.list': async () => ({ items: [], hasMore: false }),
        'calendar.list': async () => ({ items: [] }),
        'titles.related': async () => ({ items: [] }),
        'posters.fetch': async () => ({ posters: {} }),
        'rates.create': async () => ({ rate: { id: '1', status: 'planned' } }),
        'rates.update': async () => ({
            rate: { id: '1', status: 'watching', score: 0, episodes: 0, chapters: 0, volumes: 0 },
        }),
        'rates.delete': async () => ({}),
        'rates.increment': async () => ({
            rate: { id: '1', status: 'watching', score: 0, episodes: 0, chapters: 0, volumes: 0 },
        }),
        'settings.setOrigin': async () => ({}),
        'analytics.track': async () => ({}),
        ...overrides,
    };
}

function registerBackground(overrides: Partial<MessageHandlers> = {}): void {
    onMessage(makeHandlers(overrides));
}

// Raw runtime.sendMessage is used here deliberately: the protocol robustness
// against malformed/unknown messages is testable only below the typed wrapper.
// The "no raw sendMessage" rule (docs/02) applies to app code, not this spec.
async function sendRaw(message: unknown): Promise<MessageResponse<MessageType>> {
    return (await fakeBrowser.runtime.sendMessage(message)) as MessageResponse<MessageType>;
}

describe('messaging', () => {
    beforeEach(() => {
        fakeBrowser.reset();
    });

    describe('ping round-trip', () => {
        it('responds with { ok: true, data: { pong: true } }', async () => {
            registerBackground();
            const response = await sendMessage('ping');
            // Exact shape: breaking the { ok, data } envelope must fail this test.
            expect(response).toEqual({ ok: true, data: { pong: true } });
        });

        it('uses ok as the discriminant of the response union', async () => {
            registerBackground();
            const response = await sendMessage('ping');
            expect(response.ok).toBe(true);
            if (response.ok) {
                expect(response.data.pong).toBe(true);
            }
        });
    });

    describe('auth round-trip', () => {
        it('auth.getState returns anonymous state without a user', async () => {
            registerBackground();
            const response = await sendMessage('auth.getState');
            expect(response).toEqual({ ok: true, data: { status: 'anonymous' } });
        });

        it('auth.getState returns authorized state with the user', async () => {
            registerBackground({
                'auth.getState': async () => ({ status: 'authorized', user: testUser }),
            });
            const response = await sendMessage('auth.getState');
            expect(response).toEqual({
                ok: true,
                data: { status: 'authorized', user: testUser },
            });
        });

        it('auth.login returns only { user }', async () => {
            registerBackground();
            const response = await sendMessage('auth.login');
            expect(response).toEqual({ ok: true, data: { user: testUser } });
        });

        it('auth.logout returns an empty data object', async () => {
            registerBackground();
            const response = await sendMessage('auth.logout');
            expect(response).toEqual({ ok: true, data: {} });
        });
    });

    describe('settings round-trip', () => {
        it('settings.setOrigin delivers the origin and answers with an empty data object', async () => {
            const received: Origin[] = [];
            registerBackground({
                'settings.setOrigin': async ({ origin }) => {
                    received.push(origin);
                    return {};
                },
            });

            const response = await sendMessage('settings.setOrigin', {
                origin: 'https://shikimori.one',
            });

            expect(response).toEqual({ ok: true, data: {} });
            expect(received).toEqual(['https://shikimori.one']);
        });
    });

    describe('related round-trip', () => {
        it('titles.related delivers the target and answers with the list as given', async () => {
            const asked: { targetId: string; targetType: RateTargetType }[] = [];
            registerBackground({
                'titles.related': async (payload) => {
                    asked.push(payload);
                    return { items: [relatedItem] };
                },
            });

            const response = await sendMessage('titles.related', {
                targetId: '5114',
                targetType: 'Anime',
            });

            // The wire must not reshape the list: grouping and ordering are the
            // UI's job (src/lib/related.ts), so what background answered is
            // exactly what arrives.
            expect(response).toEqual({ ok: true, data: { items: [relatedItem] } });
            expect(asked).toEqual([{ targetId: '5114', targetType: 'Anime' }]);
        });

        it('carries a Manga target, so a ranobe card reaches the manga read path', async () => {
            const asked: RateTargetType[] = [];
            registerBackground({
                'titles.related': async ({ targetType }) => {
                    asked.push(targetType);
                    return { items: [] };
                },
            });

            await sendMessage('titles.related', { targetId: '81669', targetType: 'Manga' });
            expect(asked).toEqual(['Manga']);
        });

        it('answers with an empty list for a title without relations', async () => {
            // A normal state with its own text on the screen, not a failure
            // (docs/03): it must not come back as { ok: false }.
            registerBackground();
            const response = await sendMessage('titles.related', {
                targetId: '199',
                targetType: 'Anime',
            });
            expect(response).toEqual({ ok: true, data: { items: [] } });
        });
    });

    describe('error responses', () => {
        it('maps a throwing handler to { ok: false, error: { kind: "internal" } } without leaking the error', async () => {
            registerBackground({
                ping: async () => {
                    throw new Error('secret-should-not-leak');
                },
            });
            const response = await sendMessage('ping');
            expect(response).toEqual({
                ok: false,
                error: { kind: 'internal', message: 'Handler failed: ping' },
            });
            // The thrown error text must never reach the response (CLAUDE.md rule 6).
            expect(JSON.stringify(response)).not.toContain('secret-should-not-leak');
        });

        it('maps a not-implemented auth stub to a generic internal error', async () => {
            // Plain Error throws (bugs) stay generic, unlike ApiError throws below.
            registerBackground({
                'auth.login': async () => {
                    throw new Error('auth.login not implemented');
                },
            });
            const response = await sendMessage('auth.login');
            expect(response).toEqual({
                ok: false,
                error: { kind: 'internal', message: 'Handler failed: auth.login' },
            });
        });

        it('passes an unauthorized ApiError thrown by a handler through with its kind', async () => {
            // docs/02 error model: the UI distinguishes 'unauthorized' («Войти
            // заново») from 'internal', so the kind must survive dispatch.
            registerBackground({
                'auth.login': async () => {
                    throw { kind: 'unauthorized' } satisfies ApiError;
                },
            });
            const response = await sendMessage('auth.login');
            expect(response).toEqual({ ok: false, error: { kind: 'unauthorized' } });
        });

        it('passes an api ApiError through with status and message intact', async () => {
            registerBackground({
                'auth.login': async () => {
                    throw {
                        kind: 'api',
                        status: 422,
                        message: 'Validation failed',
                    } satisfies ApiError;
                },
            });
            const response = await sendMessage('auth.login');
            expect(response).toEqual({
                ok: false,
                error: { kind: 'api', status: 422, message: 'Validation failed' },
            });
        });

        it('does not treat a random object with a kind field as an ApiError', async () => {
            registerBackground({
                'auth.login': async () => {
                    throw { kind: 'exotic-failure' };
                },
            });
            const response = await sendMessage('auth.login');
            expect(response).toEqual({
                ok: false,
                error: { kind: 'internal', message: 'Handler failed: auth.login' },
            });
        });

        it('rejects an unknown message type', async () => {
            registerBackground();
            const response = await sendRaw({ type: 'nope' });
            expect(response).toEqual({
                ok: false,
                error: { kind: 'internal', message: 'Unknown message type: nope' },
            });
        });

        it('rejects a malformed message without a string type', async () => {
            registerBackground();
            const response = await sendRaw({ foo: 'bar' });
            expect(response).toEqual({
                ok: false,
                error: { kind: 'internal', message: 'Malformed message' },
            });
        });

        it('returns { ok: false } when no background listener is registered', async () => {
            // fake-browser throws "No listeners available", mirroring Chrome's
            // "Receiving end does not exist" rejection.
            const response = await sendMessage('ping');
            expect(response).toEqual({
                ok: false,
                error: { kind: 'internal', message: 'No response from background' },
            });
        });
    });
});
