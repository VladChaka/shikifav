import { browser } from 'wxt/browser';

// Typed popup/options <-> background protocol (docs/02-architecture.md).
// Raw browser.runtime.sendMessage calls outside this module are forbidden.

// Phase 0: declared here; moves to src/lib/api/types.ts in phase 1.
export type ApiError =
    | { kind: 'network' } // fetch failed / timeout
    | { kind: 'unauthorized' } // 401 after a refresh attempt
    | { kind: 'rate_limited'; retryAfterMs?: number }
    | { kind: 'api'; status: number; message: string } // 4xx/5xx, including 422
    | { kind: 'internal'; message: string };

// Single registry of all message types. Phase 0 has only the service `ping`;
// auth.*, search.*, rates.* are added in later phases.
export interface MessageMap {
    ping: { payload: undefined; data: { pong: true } };
}

export type MessageType = keyof MessageMap;

export type MessageResponse<T extends MessageType> =
    { ok: true; data: MessageMap[T]['data'] } | { ok: false; error: ApiError };

type PayloadArgs<T extends MessageType> = MessageMap[T]['payload'] extends undefined
    ? []
    : [payload: MessageMap[T]['payload']];

export type MessageHandlers = {
    [T in MessageType]: (payload: MessageMap[T]['payload']) => Promise<MessageMap[T]['data']>;
};

interface MessageRequest {
    type: MessageType;
    payload?: unknown;
}

function isMessageRequest(value: unknown): value is MessageRequest {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as { type?: unknown }).type === 'string'
    );
}

async function dispatch(
    handlers: MessageHandlers,
    rawMessage: unknown,
): Promise<MessageResponse<MessageType>> {
    if (!isMessageRequest(rawMessage)) {
        return { ok: false, error: { kind: 'internal', message: 'Malformed message' } };
    }
    const handler = handlers[rawMessage.type] as
        ((payload: unknown) => Promise<MessageMap[MessageType]['data']>) | undefined;
    if (!handler) {
        return {
            ok: false,
            error: { kind: 'internal', message: `Unknown message type: ${rawMessage.type}` },
        };
    }
    try {
        return { ok: true, data: await handler(rawMessage.payload) };
    } catch (e) {
        console.debug('[messaging] handler failed:', rawMessage.type, e);
        return {
            ok: false,
            error: { kind: 'internal', message: `Handler failed: ${rawMessage.type}` },
        };
    }
}

export async function sendMessage<T extends MessageType>(
    type: T,
    ...args: PayloadArgs<T>
): Promise<MessageResponse<T>> {
    try {
        const response: unknown = await browser.runtime.sendMessage({ type, payload: args[0] });
        return response as MessageResponse<T>;
    } catch (e) {
        console.debug('[messaging] sendMessage failed:', type, e);
        return { ok: false, error: { kind: 'internal', message: 'No response from background' } };
    }
}

// Registers the single background listener.
export function onMessage(handlers: MessageHandlers): void {
    browser.runtime.onMessage.addListener(
        (
            rawMessage: unknown,
            _sender: unknown,
            sendResponse: (response: MessageResponse<MessageType>) => void,
        ) => {
            const result = dispatch(handlers, rawMessage);
            if (typeof sendResponse === 'function') {
                void result.then(sendResponse);
                return true; // Chrome: keep the channel open, respond via sendResponse
            }
            return result; // fake-browser (tests): awaits the returned promise
        },
    );
}
