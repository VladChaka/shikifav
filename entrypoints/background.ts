import { trackEvent } from '@/src/lib/api/analytics';
import { ensureToken, getAuthState, login, logout } from '@/src/lib/api/auth';
import { listCalendar, listRates, searchTitles } from '@/src/lib/api/graphql';
import { setTokenProvider } from '@/src/lib/api/http';
import { fetchPosters } from '@/src/lib/api/posters';
import { createRate, deleteRate, incrementRate, updateRate } from '@/src/lib/api/rates';
import { registerUserAgentRule } from '@/src/lib/api/user-agent-rule';
import { handleMenuClick, registerContextMenu } from '@/src/lib/context-menu';
import { eventForMessage } from '@/src/lib/analytics-from-message';
import { onMessage } from '@/src/lib/messaging';
import type { MessageHandlers, MessageType } from '@/src/lib/messaging';
import { setSettings } from '@/src/lib/storage';

// Measurement is bolted onto the handler table rather than sprinkled through
// the composables: one place decides what is reported (analytics-from-message),
// and one place sends it. A handler stays unaware that it is measured, and a
// failing measurement cannot fail a user action — trackEvent swallows its own
// errors, and the event is sent only after the handler has already succeeded.
function measured(handlers: MessageHandlers): MessageHandlers {
    const entries = Object.entries(handlers) as [
        MessageType,
        (payload: unknown) => Promise<unknown>,
    ][];
    return Object.fromEntries(
        entries.map(([type, handler]) => [
            type,
            async (payload: unknown) => {
                const data = await handler(payload);
                const event = eventForMessage(type, payload);
                if (event) {
                    await trackEvent(event);
                }
                return data;
            },
        ]),
    ) as MessageHandlers;
}

export default defineBackground(() => {
    // Module state dies with the service worker; defineBackground runs on every
    // SW start, so the provider is always registered before any API request.
    setTokenProvider(ensureToken);

    // Chrome drops the fetch()-level User-Agent in the MV3 SW (docs/03), so a
    // DNR rule enforces it; errors are swallowed inside (console.debug only).
    void registerUserAgentRule();

    // Listener is added synchronously on every SW start: a click on the menu
    // item wakes the worker up and must find the handler already attached.
    browser.contextMenus.onClicked.addListener((info) => {
        void handleMenuClick(info);
    });

    // Menu items are persistent, so registering them once per install/update is
    // enough — a create() with an existing id on every SW start would fail.
    // onStartup repeats it once per browser session as a cheap recovery path:
    // registerContextMenu() swallows its errors, so a single failed install
    // would otherwise leave the profile without the menu item until reinstall
    // (removeAll() before create() keeps the repeat idempotent).
    browser.runtime.onInstalled.addListener(() => {
        void registerContextMenu();
    });
    browser.runtime.onStartup.addListener(() => {
        void registerContextMenu();
    });

    // MessageHandlers is a mapped type over every MessageMap key, so this object
    // must stay exhaustive: adding a message type without a handler fails compile.
    onMessage(
        measured({
            ping: async () => ({ pong: true }),
            'auth.getState': () => getAuthState(),
            'auth.login': async () => ({ user: await login() }),
            'auth.logout': async () => {
                await logout();
                return {};
            },
            'search.titles': async ({ query, type, page }) => ({
                items: await searchTitles(query, type, page),
            }),
            'rates.list': async ({ type, status, page }) => {
                // hasMore is computed in the read layer from the raw page length, so
                // a dropped userRate==null row cannot cut paging short (docs/06).
                const { items, hasMore } = await listRates(type, status, page);
                return { items, hasMore };
            },
            'calendar.list': async () => ({
                // Paging lives entirely in the read layer: the calendar is one
                // screen without an «Ещё» button, so the popup never sees pages.
                items: await listCalendar(),
            }),
            'posters.fetch': async ({ type, ids }) => ({
                // Ф6-27: GraphQL gives no poster for part of the catalogue, so the
                // UI asks for the missing ones separately — one REST batch, after
                // the page is already rendered.
                posters: await fetchPosters(type, ids),
            }),
            'rates.create': async ({ targetId, targetType, status }) => ({
                rate: await createRate(targetId, targetType, status),
            }),
            'rates.update': async ({ rateId, patch }) => ({
                rate: await updateRate(rateId, patch),
            }),
            'rates.delete': async ({ rateId }) => {
                await deleteRate(rateId);
                return {};
            },
            'rates.increment': async ({ rateId }) => ({
                rate: await incrementRate(rateId),
            }),
            'analytics.track': async (event) => {
                // Awaited, not fired and forgotten: the service worker may be
                // terminated as soon as the last handler settles, and an unawaited
                // request would be cancelled with it. trackEvent swallows its own
                // errors, so this can never fail the message.
                await trackEvent(event);
                return {};
            },
            'settings.setOrigin': async ({ origin }) => {
                // Changing the domain ends the session by construction: the token
                // was issued by the app on one domain, cross-domain validity was
                // never verified, and .one answers 301 to POST /oauth/token, so it
                // cannot even be refreshed there (docs/03, docs/04).
                // Order is strict — logout() first, settings after. The reverse
                // would open a window where the new origin is already in storage
                // while the old token is still there, and any request in between
                // would go to the new domain with a foreign Bearer.
                await logout();
                await setSettings({ origin });
                return {};
            },
        }),
    );
});
