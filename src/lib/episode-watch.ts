import { browser } from 'wxt/browser';
import type { Browser } from 'wxt/browser';
import { pollAiredAnimes } from './api/graphql';
import { isApiError } from './api/types';
import type { AiredPollItem } from './api/types';
import { diffAired } from './aired-snapshot';
import { clearBadge, showAiredBacklog } from './badge';
import type { BadgeRow } from './badge-backlog';
import { clearAiredNotifications, notifyAiredEpisodes } from './episode-notifications';
import { isSessionEpochCurrent, sessionEpoch } from './session-epoch';
import {
    clearAiredSnapshot,
    getAiredSnapshot,
    getLocal,
    getSettings,
    setAiredSnapshot,
} from './storage';

// Background scheduler of the airing watch (US-12, Ф11-7): one periodic alarm,
// one short tick. Everything it decides is decided here; the arithmetic lives in
// pure modules (aired-snapshot.ts, calendar-schedule.ts, badge-backlog.ts).
//
// Deliberately NOT wrapped in measured() (docs/06, Ф11-12): a background tick
// that reports its failures would make a logged-out or offline profile send an
// `api_failed` every half hour, while PRIVACY.md promises errors of REQUESTS to
// Shikimori, not errors of our own alarm.

export const EPISODE_WATCH_ALARM = 'shikifav-episode-watch';

// The one period of the feature. 30 minutes is the owner-approved constant
// (docs/06): the lag between an air slot and the episode showing up in the
// Shikimori database has a median of ~46 minutes, so a faster tick would buy
// precision the data does not have. Cost at this period is ≤0,2 rpm out of our
// 80 (1–3 requests per tick, CLAUDE.md rule 2).
export const EPISODE_WATCH_PERIOD_MINUTES = 30;

// First tick after the alarm is (re)created — an install, an update, or the
// feature being switched on. Alarms do not survive an extension update, so
// without a short first delay the badge of an updated profile would wait a full
// period for its first refresh. Chrome honours anything from 0,5 minutes up.
export const EPISODE_WATCH_FIRST_DELAY_MINUTES = 1;

// Takes the name alone: a full Alarm satisfies it, and the extension has to keep
// its hands off alarms it did not create — a click on someone else's alarm must
// not start a poll.
export function isEpisodeWatchAlarm(alarm: Pick<Browser.alarms.Alarm, 'name'>): boolean {
    return alarm.name === EPISODE_WATCH_ALARM;
}

// Brings the alarm in line with THREE conditions: the setting, the session, and
// whether an alarm is there already. Idempotent by construction: an
// existing alarm is left alone (re-creating it would reset its schedule), and a
// missing one is created. Called on install, on browser start — an alarm is gone
// after an update, so "is it there?" has to be asked on every start — and on
// every settings write, so switching the feature off stops it at once instead of
// at the next tick.
export async function syncEpisodeWatchAlarm(): Promise<void> {
    try {
        const { episodeWatch } = await getSettings();
        if (!episodeWatch) {
            await browser.alarms.clear(EPISODE_WATCH_ALARM);
            // The counter belongs to the feature: switched off, it must not keep
            // a number on the icon that nothing updates any more.
            await clearBadge();
            // And neither the data behind it. The snapshot is a map «тайтл →
            // сколько серий вышло» of somebody's lists: left in storage.local it
            // would outlive the switched-off feature indefinitely, and the day it
            // is switched back on the diff would run against a snapshot from
            // weeks ago and fire a burst of notifications at once.
            await clearAiredSnapshot();
            // Messages already in the tray carry the names of those titles, and
            // the system keeps them until the user dismisses them by hand.
            await clearAiredNotifications();
            return;
        }
        // Ф11 audit. A profile that never logged in got an alarm all the same,
        // and it woke the service worker every half hour for a tick that leaves
        // on its own auth guard — forever. No session, no alarm; the login
        // handler asks for one back (entrypoints/background.ts).
        if (!(await getLocal('auth'))) {
            await browser.alarms.clear(EPISODE_WATCH_ALARM);
            return;
        }
        if (await browser.alarms.get(EPISODE_WATCH_ALARM)) {
            return;
        }
        await browser.alarms.create(EPISODE_WATCH_ALARM, {
            delayInMinutes: EPISODE_WATCH_FIRST_DELAY_MINUTES,
            periodInMinutes: EPISODE_WATCH_PERIOD_MINUTES,
        });
    } catch (e) {
        // A profile without a working alarms API still has a fully usable
        // extension; it just never refreshes the badge on its own.
        console.debug('[episode-watch] failed to sync the alarm:', errorKind(e));
    }
}

// Single-flight for the same reason as the token refresh: a tick can live for
// about three minutes (a 429 is retried inside http.ts up to three times with a
// pause of up to 60 s), and two overlapping ticks would diff the same snapshot
// twice — the second one would see its own writes and report nothing.
//
// The slot carries the identity of the run that owns it (Ф11 audit): an
// unconditional `.finally` cleared whatever was in the slot, including a tick
// that had REPLACED the finishing one after forgetEpisodeWatchTick(). The next
// alarm then started a second tick alongside the live one, and the two diffed
// the same snapshot — exactly what single-flight exists to prevent.
let tickInFlight: { token: symbol; promise: Promise<void> } | undefined;

export function runEpisodeWatchTick(): Promise<void> {
    if (tickInFlight) {
        return tickInFlight.promise;
    }
    const token = Symbol('episode-watch-tick');
    const promise = doTick().finally(() => {
        if (tickInFlight?.token === token) {
            tickInFlight = undefined;
        }
    });
    tickInFlight = { token, promise };
    return promise;
}

// A login changes whose lists the tick is about, so the one in flight stops
// counting as an answer for the caller after it: single-flight would otherwise
// hand back a poll issued under the previous session, and the new account would
// go unpolled until the next alarm. The abandoned tick is not cancelled —
// nothing can cancel it — it merely stops being reused (background.ts).
export function forgetEpisodeWatchTick(): void {
    tickInFlight = undefined;
}

async function doTick(): Promise<void> {
    try {
        // GUARD 1 — the setting. Off means no request at all, and the alarm that
        // woke us up should not exist either: a settings write made while the
        // worker was asleep is delivered late, so the tick repairs it.
        const { episodeWatch } = await getSettings();
        if (!episodeWatch) {
            await syncEpisodeWatchAlarm();
            return;
        }
        // GUARD 2 — the session. A logged-out profile makes ZERO requests in the
        // background (DoD of phase 11): without this, every half hour would cost
        // a refused request, and an expired token a refresh on top of it.
        if (!(await getLocal('auth'))) {
            await clearBadge();
            return;
        }

        // Taken BEFORE the poll and checked after it: the poll can live for
        // minutes, and a logout or a login in that window makes everything this
        // tick is about belong to a session that is over (src/lib/session-epoch.ts).
        const epoch = sessionEpoch();
        const items = await pollAiredAnimes();
        const previous = await getAiredSnapshot();
        // The snapshot is advanced on every tick, notifications or not: the diff
        // is what makes a tick idempotent — a second run over the same answer
        // finds no increases and rewrites the same numbers.
        const { snapshot, increases } = diffAired(previous, items);
        // THE FENCE, asked again before EVERY write and before the message
        // (Ф11 audit). A single check before three consecutive awaits closed only
        // the first of them: a logout landing in that window still got the
        // snapshot, the badge and the notifications of the session it ended —
        // and a notification is I/O to the outside world, so no ordering of
        // storage writes can take it back.
        if (!(await stillOurs(epoch))) {
            return;
        }
        await setAiredSnapshot(snapshot);
        if (!(await stillOurs(epoch))) {
            // The residual race the fence alone does not close (найдено ревью).
            // A logout landing while the write above was already on its way puts
            // the snapshot back AFTER clearAuth() removed it, and the snapshot of
            // a finished session then outlives it until the next tick or login —
            // a map of somebody's lists in storage.local, and a diff base for an
            // account that may already be a different one. The badge and the
            // notifications were covered by the fence; this write was not,
            // because it had already happened when the fence was asked.
            await clearAiredSnapshot();
            return;
        }
        await showAiredBacklog(items.map(toBadgeRow));
        // Last, and after the snapshot is already stored: a notification that
        // failed must not cost the advance of the counter, or the same episode
        // would be reported again on every tick. The call is total and gated
        // twice inside — by the setting and by the Chrome permission (Ф11-10).
        //
        // The fence goes INSIDE (найдено ревью): checking it here left two awaits
        // and up to three create() calls unfenced, so a logout landing in that
        // window ran clearAiredNotifications() before the messages existed and
        // left them — and their stored addresses — behind. A single check here
        // would now be a line no test can turn red.
        await notifyAiredEpisodes(increases, items, () => stillOurs(epoch));
    } catch (e) {
        // No `unauthorized` branch here on purpose (ревью Ф11-10). Every
        // unauthorized an AUTHORIZED tick can see has already been through
        // clearAuth() — a refresh that lost the session, a 401 that survived the
        // forced refresh — and clearAuth() is the one place that wipes the badge
        // (src/lib/api/auth.ts). The case «нет сессии» never reaches here at all:
        // it leaves on guard 2 above. A second clearBadge() here would be a line
        // no test can turn red, which is how the previous one was found.
        //
        // Everything else (offline, 429 after the retries, a server error) is a
        // tick that simply did not happen: the badge keeps its last known number
        // and the next alarm tries again.
        console.debug('[episode-watch] tick failed:', errorKind(e));
    }
}

// May this tick still write? Two questions, and the order of the two is what
// makes the answer worth anything: the setting is read first because reading it
// is an await, and the epoch — a plain number in memory — is compared LAST, with
// nothing between the comparison and the write the caller makes next.
//
// The setting is re-read for the same reason as the epoch: switching the feature
// off while a poll was in the air used to leave the number of that poll frozen
// on the icon, because syncEpisodeWatchAlarm() had already wiped the badge
// before the tick landed.
async function stillOurs(epoch: number): Promise<boolean> {
    const { episodeWatch } = await getSettings();
    return episodeWatch && isSessionEpochCurrent(epoch);
}

function toBadgeRow(item: AiredPollItem): BadgeRow {
    return {
        rateId: item.rateId,
        episodesAired: item.episodesAired,
        progress: item.progress,
    };
}

function errorKind(e: unknown): string {
    if (isApiError(e)) {
        return e.kind;
    }
    return e instanceof Error ? e.name : typeof e;
}
