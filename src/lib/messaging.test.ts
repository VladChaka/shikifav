import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { onMessage, sendMessage } from './messaging';
import type { MessageResponse, MessageType } from './messaging';

// fake-browser invokes onMessage listeners without sendResponse, so these tests
// exercise the promise-return branch of the listener; the sendResponse+return true
// branch is Chrome-only and stays on the manual smoke checklist.

function registerBackground(): void {
    // Mirrors entrypoints/background.ts: the single background listener.
    onMessage({
        ping: async () => ({ pong: true }),
    });
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

    describe('error responses', () => {
        it('maps a throwing handler to { ok: false, error: { kind: "internal" } } without leaking the error', async () => {
            onMessage({
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
