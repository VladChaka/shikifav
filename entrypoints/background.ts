import { trackEvent } from '@/src/lib/api/analytics';
import { ensureToken, getAuthState, login, logout } from '@/src/lib/api/auth';
import { listCalendar, listRates, listRelated, searchTitles } from '@/src/lib/api/graphql';
import { setTokenProvider } from '@/src/lib/api/http';
import { fetchPosters } from '@/src/lib/api/posters';
import { createRate, deleteRate, incrementRate, updateRate } from '@/src/lib/api/rates';
import { registerUserAgentRule } from '@/src/lib/api/user-agent-rule';
import { applyRateWrite, clearBadge, forgetRate, restoreBadge } from '@/src/lib/badge';
import { handleMenuClick, registerContextMenu } from '@/src/lib/context-menu';
import { registerAiredNotificationClicks } from '@/src/lib/episode-notifications';
import {
    forgetEpisodeWatchTick,
    isEpisodeWatchAlarm,
    runEpisodeWatchTick,
    syncEpisodeWatchAlarm,
} from '@/src/lib/episode-watch';
import { isApiError } from '@/src/lib/api/types';
import { isSessionEpochCurrent, sessionEpoch } from '@/src/lib/session-epoch';
import { eventForError, eventForMessage } from '@/src/lib/analytics-from-message';
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
                let data: unknown;
                try {
                    data = await handler(payload);
                } catch (e) {
                    // Ф10-13: failures as the error model already classifies
                    // them (docs/02), and only those that are actually a
                    // request to Shikimori — eventForError decides, the same
                    // way eventForMessage decides for successes.
                    const failure = isApiError(e) ? eventForError(e) : null;
                    if (failure) {
                        await trackEvent(failure);
                    }
                    throw e;
                }
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
        // Ф10-12: only that the item was used. The click carries the selected
        // text, and it goes no further than handleMenuClick.
        void handleMenuClick(info).then(() =>
            trackEvent({ name: 'context_menu_used', params: {} }),
        );
    });

    // Ф11-7. Same rule as the menu click: the alarm wakes the worker up and must
    // find its listener already attached, so this cannot wait for an await.
    browser.alarms.onAlarm.addListener((alarm) => {
        if (!isEpisodeWatchAlarm(alarm)) {
            return;
        }
        // No trackEvent here on purpose (docs/06, Ф11-12): a background tick must
        // not report anything — a logged-out or offline profile would otherwise
        // send an event every half hour.
        void runEpisodeWatchTick();
    });

    // Ф11-10. Same rule again, with one difference: `notifications` is an
    // OPTIONAL permission, so on a profile that never granted it the API is not
    // there to subscribe to — the call swallows that inside instead of taking
    // the worker down, and the next start after the grant subscribes for real.
    registerAiredNotificationClicks();

    // Ф11-9. The badge is redrawn from the stored rows on every worker start:
    // whether Chrome keeps the text across a worker death is not measured yet
    // (Ф11-3), and restoring a number we already have is free — unlike the
    // alternative, which would turn every wake-up into a request.
    void restoreBadge();

    // Ф11-7. Unconditionally, on every worker start, and not only from
    // onInstalled/onStartup: an alarm can also go missing without either of them
    // firing — the extension switched off and on again, a manual Reload on the
    // extensions page, an alarms.create() that was refused and swallowed. Nobody
    // would restore it before the next browser restart, and the counter would sit
    // frozen with no way to tell. The call is idempotent (an existing alarm keeps
    // its schedule) and costs one settings read plus one alarms.get().
    void syncEpisodeWatchAlarm();

    // Menu items are persistent, so registering them once per install/update is
    // enough — a create() with an existing id on every SW start would fail.
    // onStartup repeats it once per browser session as a cheap recovery path:
    // registerContextMenu() swallows its errors, so a single failed install
    // would otherwise leave the profile without the menu item until reinstall
    // (removeAll() before create() keeps the repeat idempotent).
    browser.runtime.onInstalled.addListener(() => {
        void registerContextMenu();
        // An alarm does not survive an extension update. The worker body above
        // already asked for one on this very start; this repeat is the cheap
        // recovery path for the case where that first attempt was refused, and
        // it is idempotent — an existing alarm keeps its current schedule.
        void syncEpisodeWatchAlarm();
    });
    browser.runtime.onStartup.addListener(() => {
        void registerContextMenu();
        void syncEpisodeWatchAlarm();
    });

    // Ф11-7. The options page writes settings straight to storage (no message —
    // see docs/02), so this is how switching the airing watch off removes the
    // alarm at once, and switching it back on creates one without waiting for a
    // browser restart.
    browser.storage.local.onChanged.addListener((changes) => {
        if ('settings' in changes) {
            void syncEpisodeWatchAlarm();
        }
    });

    // MessageHandlers is a mapped type over every MessageMap key, so this object
    // must stay exhaustive: adding a message type without a handler fails compile.
    onMessage(
        measured({
            ping: async () => ({ pong: true }),
            'auth.getState': () => getAuthState(),
            'auth.login': async () => {
                const user = await login();
                // Ф11-9. The rows behind the badge describe the lists of whoever
                // was logged in before — the same reason login drops the airing
                // snapshot (auth.ts). Cleared first, then refilled by a tick
                // started without being awaited: the login answer must not wait
                // for a poll, and a worker killed in the middle of one simply
                // leaves the badge to the next alarm (nothing is half-written —
                // the snapshot is stored only after the poll returns).
                await clearBadge();
                // A tick already in flight was started for the account that just
                // went away: single-flight would hand that same promise back
                // instead of polling, and the new account would wait for the next
                // alarm. Nothing can cancel the old tick — this only stops it
                // from standing in for the new one.
                forgetEpisodeWatchTick();
                void runEpisodeWatchTick();
                // Ф11 audit: an anonymous profile has no alarm at all (it would
                // wake the worker every half hour for a tick that leaves on its
                // own auth guard), so the login is where it comes back. Awaited
                // — it is one settings read and one alarms.get(), and a login
                // that answered before the alarm existed would leave the counter
                // frozen until the next browser start.
                await syncEpisodeWatchAlarm();
                return { user };
            },
            'auth.logout': async () => {
                // The number on the icon belongs to the session that just ended,
                // and it is cleared inside clearAuth() (src/lib/api/auth.ts) —
                // the one point every exit from a session goes through, including
                // the domain switch below and a refresh that lost the session.
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
            'titles.related': async ({ targetId, targetType }) => ({
                // One GraphQL for the whole screen (DoD of phase 12). Nothing is
                // reshaped here: the flat server list goes straight to the UI,
                // where the pure module decides how it reads.
                items: await listRelated(targetId, targetType),
            }),
            'posters.fetch': async ({ type, ids }) => ({
                // Ф6-27: GraphQL gives no poster for part of the catalogue, so the
                // UI asks for the missing ones separately — one REST batch, after
                // the page is already rendered.
                posters: await fetchPosters(type, ids),
            }),
            // A title being ADDED is the one write the badge does not react to:
            // create answers with the narrow UserRateRef (no progress, no aired
            // counter), and a title that has just been added is not in the badge
            // rows at all. The next tick picks it up — a counter that goes UP
            // late is the harmless direction (US-12 asks it to go DOWN in time).
            'rates.create': async ({ targetId, targetType, status }) => ({
                rate: await createRate(targetId, targetType, status),
            }),
            'rates.update': async ({ rateId, patch }) => {
                // Ф11 audit: the same fence the background tick has, on the write
                // path from the popup. A REST call can live for minutes (a 429 is
                // retried inside http.ts), and a logout or an account switch
                // landing in that window would otherwise let the answer rebuild
                // the badge rows of a session that is over — clearAuth() has
                // already wiped them, and restoreBadge() would redraw the number
                // on every worker start.
                const epoch = sessionEpoch();
                const rate = await updateRate(rateId, patch);
                // Ф11-9: the answer carries the new progress and status, which is
                // all the badge needs to recount — no second request, and the
                // counter fades with the mark instead of at the next tick.
                if (isSessionEpochCurrent(epoch)) {
                    await applyRateWrite(rate);
                }
                return { rate };
            },
            'rates.delete': async ({ rateId }) => {
                const epoch = sessionEpoch();
                await deleteRate(rateId);
                if (isSessionEpochCurrent(epoch)) {
                    await forgetRate(rateId);
                }
                return {};
            },
            'rates.increment': async ({ rateId }) => {
                const epoch = sessionEpoch();
                const rate = await incrementRate(rateId);
                if (isSessionEpochCurrent(epoch)) {
                    await applyRateWrite(rate);
                }
                return { rate };
            },
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
