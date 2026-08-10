import { browser } from 'wxt/browser';
import { isApiError } from './api/types';
import type {
    ApiError,
    AuthState,
    CalendarItem,
    RateCreateParams,
    RatePatch,
    RateRow,
    RateState,
    RateTargetType,
    RelatedItem,
    SearchType,
    TitleCard,
    User,
    UserRateRef,
    UserRateStatus,
} from './api/types';
import type { AnalyticsEvent } from './analytics-events';
import type { Origin } from './config';

// Typed popup/options <-> background protocol (docs/02-architecture.md).
// Raw browser.runtime.sendMessage calls outside this module are forbidden.

// Single registry of all message types. Messages never carry tokens (docs/04 §6)
// or user_id (docs/02).
export interface MessageMap {
    ping: { payload: undefined; data: { pong: true } };
    'auth.getState': { payload: undefined; data: AuthState };
    'auth.login': { payload: undefined; data: { user: User } };
    'auth.logout': { payload: undefined; data: Record<string, never> };
    'search.titles': {
        payload: { query: string; type: SearchType; page?: number };
        data: { items: TitleCard[] };
    };
    'rates.list': {
        payload: { type: SearchType; status: UserRateStatus; page: number };
        data: { items: RateRow[]; hasMore: boolean };
    };
    // Ongoings calendar (US-9). No payload and no paging on the wire: the UI has
    // no «Ещё» button, so background walks the pages itself and answers with the
    // whole list at once (docs/02).
    'calendar.list': { payload: undefined; data: { items: CalendarItem[] } };
    // Related titles of one title (US-11, phase 12). The whole screen in one
    // answer, like calendar.list: `related` has no paging on the server side
    // either, so the only thing worth putting on the wire is where we came from.
    // The list travels FLAT and in server order — grouping by relation kind,
    // dedup and ordering are pure decisions living in src/lib/related.ts, so how
    // the screen reads is testable without a service worker and background stays
    // a pass-through.
    // `targetType` is the write target, not a catalogue section: a ranobe card
    // carries 'Manga' (TitleCard), and mangas(ids:) answers for it as is.
    'titles.related': {
        payload: { targetId: string; targetType: RateTargetType };
        data: { items: RelatedItem[] };
    };
    // Poster backfill for the titles GraphQL returns without one (Ф6-27):
    // answered with id -> absolute poster url for the ids that have a picture
    // (the rest are absent from the map). One SearchType per message stays
    // deliberate after phase 12, where the list of ids is mixed: the three REST
    // indexes are three different endpoints (api/posters.ts), so a bucketed
    // payload would not save a single request to Shikimori — it would only
    // rewrite every existing caller. A mixed list therefore costs up to three
    // messages (poster-backfill.ts), still never one per title (rule 2).
    'posters.fetch': {
        payload: { type: SearchType; ids: string[] };
        data: { posters: Record<string, string> };
    };
    'rates.create': { payload: RateCreateParams; data: { rate: UserRateRef } };
    'rates.update': {
        payload: { rateId: string; patch: RatePatch };
        data: { rate: RateState };
    };
    'rates.delete': { payload: { rateId: string }; data: Record<string, never> };
    'rates.increment': {
        payload: { rateId: string };
        data: { rate: RateState };
    };
    // The only settings message: switching the API domain ends the session, and
    // that must happen in background, in one step, next to the token (docs/04).
    // titleLang and cache clearing stay plain storage writes from the UI —
    // rule 1 restricts network, not storage, and an extra message would wake the
    // service worker for nothing (popup open budget, docs/05).
    'settings.setOrigin': { payload: { origin: Origin }; data: Record<string, never> };
    // Anonymous usage statistics (фаза 10). Network from background only, like
    // everything else (rule 1) — but this one also carries a payload the wire
    // must never widen: AnalyticsEvent is a closed union, so a query or a title
    // cannot be attached to a message even by mistake. Fire-and-forget on the
    // UI side: nothing on screen waits for a measurement.
    'analytics.track': { payload: AnalyticsEvent; data: Record<string, never> };
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
        // An ApiError thrown by a handler keeps its kind on the wire:
        // 'unauthorized' must not degrade to 'internal' (docs/02 error model).
        // Only kind reaches the log — never the full error object.
        if (isApiError(e)) {
            console.debug('[messaging] handler error:', rawMessage.type, e.kind);
            return { ok: false, error: e };
        }
        console.debug(
            '[messaging] handler failed:',
            rawMessage.type,
            e instanceof Error ? e.message : typeof e,
        );
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
