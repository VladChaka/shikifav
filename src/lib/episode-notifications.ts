import { browser } from 'wxt/browser';
import type { AiredIncrease } from './aired-snapshot';
import type { AiredPollItem } from './api/types';
import { shikimoriHref } from './external-url';
import { airedEpisodesMessage, i18n } from './i18n';
import { hasNotificationsPermission } from './notifications-permission';
import { getSession, getSettings, removeSession, setSession } from './storage';
import { displayTitle } from './title-name';
import type { TitleLang } from './title-name';

// System notifications about an episode that came out (US-12, Ф11-10).
// Background-only, like everything the tick touches: the only module that calls
// browser.notifications.
//
// TWO gates, both mandatory. The setting `episodeNotifications` is the user's
// answer, and browser.permissions is Chrome's: `notifications` is declared
// OPTIONAL (owner's decision 2), so without the grant the API does not exist at
// all and every call here would throw.
//
// Everything below is total. A notification is decoration on top of a tick that
// has already stored its snapshot and drawn its badge — it must never fail the
// tick, and it must never leave the tick half-done.

// The id is what tells our notification from anyone else's on click, and it
// carries the title id so a second episode of the same title REPLACES the first
// message instead of stacking a second one (Chrome reuses an existing id).
export const AIRED_NOTIFICATION_PREFIX = 'shikifav-aired:';

// Local resource, never a poster: `iconUrl` accepts an extension resource or a
// data URL, and titles rated 18+ have no poster in GraphQL at all — it would
// cost an extra request at exactly the moment the message has to be shown
// (docs/06, границы фазы 11).
const NOTIFICATION_ICON = '/icon/128.png';

// The name comes from the API and is shown by the SYSTEM, next to our icon and
// our extension name — i.e. it borrows our identity. Chrome truncates the title
// itself, so this cap is not about layout: it is the guard against a name built
// to push anything after it off the visible line. 100 characters is far past any
// real title and far below any payload.
export const MAX_NOTIFICATION_TITLE_LENGTH = 100;

// How many separate messages one tick may put in the tray. A laptop that spent
// a few days switched off comes back with a snapshot that survived the pause,
// and the first tick diffs a week of airings at once: without a cap that is up
// to ONGOING_LIMIT × ONGOING_MAX_PAGES = 150 notifications, each carrying the
// name of a title from someone's lists, fired seconds after the machine wakes
// up. Everything past the cap moves the snapshot SILENTLY — a deliberate step
// away from owner's decision 4 («одно уведомление на тайтл»), taken as the fix
// of that burst.
//
// There is no summary message for the rest (owner's decision 2026-08-17). A
// summary has no single title, so it has no address to lead a click to, and the
// only remaining destination — the extension in a tab — is precisely the state
// that the click decision removed from the product. How many others are waiting
// is what the number on the icon says; that is what it is for.
export const MAX_AIRED_NOTIFICATIONS_PER_TICK = 3;

// An episode number outside this range is not an episode number. The upper
// bound clears the longest running shows by an order of magnitude (Sazae-san is
// under 9 000), and the lower one is what makes «Вышла 0 серия» impossible.
const MIN_EPISODE_NUMBER = 1;
const MAX_EPISODE_NUMBER = 99_999;

// Everything that is not text: it either takes no visible space or stacks on
// top of what came before, and both are ways to make one line look like several,
// or like text written by somebody else.
//
// The categories: C0/C1 controls (newlines among them), format characters (the
// bidi overrides, which reverse the visible order of what follows), lone
// surrogates, private use and unassigned code points, the two line separators,
// and BOTH kinds of combining marks — a «Zalgo» name is nothing but a hundred of
// those on one letter.
//
// The literal tail is the invisible characters Unicode files under VISIBLE
// categories: braille blank (So) and the four Hangul fillers (Lo). Each of them
// passed a category-only filter and reached the screen as a title that renders
// completely blank next to our icon and our name (прогон 2026-08-17).
const NOT_TEXT =
    /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Mn}\p{Me}\u{2800}\u{115F}\u{1160}\u{3164}\u{FFA0}]/gu;

// The name arrives from the API, i.e. it is untrusted input — and it is not even
// guaranteed to be a string: a row with `name: null` used to reach here and
// throw, and one throw killed the notifications of every other title of the
// tick. Anything that is not a string is a title without a name.
export function sanitizeNotificationTitle(raw: unknown): string {
    if (typeof raw !== 'string') {
        return i18n.notifications.untitled;
    }
    const flattened = raw
        // Composed first: a legitimate «й» or «Á» may arrive as a base letter
        // plus a combining mark, and the strip below would leave the letter
        // bare. What survives NFC is what no real name needs.
        .normalize('NFC')
        .replace(NOT_TEXT, ' ')
        // Collapsed afterwards: the replacement above turns a stripped character
        // into a space, and three of them in a row must not become a three-space
        // gap. \s also covers the exotic spaces (U+00A0, U+1680, U+3000).
        .replace(/\s+/gu, ' ')
        .trim();
    // AFTER the strip, never before it. The other way round is how a name built
    // out of invisible-but-not-blank characters got through: it was not empty as
    // a string, so the fallback did not fire, and it was empty on screen.
    if (flattened.length === 0) {
        return i18n.notifications.untitled;
    }
    // Code points, not UTF-16 units: a name of emoji is twice as long by
    // `.length`, and a cut by units lands in the middle of a surrogate pair and
    // ends the title with half a character.
    const characters = [...flattened];
    if (characters.length <= MAX_NOTIFICATION_TITLE_LENGTH) {
        return flattened;
    }
    // The ellipsis takes the place of the last kept character, so the result is
    // never longer than the cap. trimEnd: the cut can land on a space.
    const kept = characters.slice(0, MAX_NOTIFICATION_TITLE_LENGTH - 1).join('');
    return `${kept.trimEnd()}…`;
}

// The episodes that are new since the previous snapshot: `from + 1 … to`. Both
// bounds are validated as whole numbers in range, and `null` means "say nothing"
// — a message with an invented number is worse than no message.
export function airedEpisodeRange(increase: AiredIncrease): { first: number; last: number } | null {
    const { from, to } = increase;
    if (!Number.isInteger(from) || !Number.isInteger(to) || to <= from) {
        return null;
    }
    const first = from + 1;
    if (first < MIN_EPISODE_NUMBER || to > MAX_EPISODE_NUMBER) {
        return null;
    }
    return { first, last: to };
}

// One increase that has everything a message needs: a row to take the name from
// and a validated episode range.
interface AiredMessage {
    item: AiredPollItem;
    range: { first: number; last: number };
}

// One notification per title, for all three calendar statuses (owner's decision
// 4), up to MAX_AIRED_NOTIFICATIONS_PER_TICK of them — everything past the cap
// passes in silence. The silent seed is not a case this module has to handle: a
// title the previous snapshot knew nothing about produces no increase at all
// (src/lib/aired-snapshot.ts), which is what keeps a title just added to a list
// from firing a burst of messages.
//
// `stillOurs` is the session fence of the caller, asked HERE and not once before
// the call (найдено ревью): between the caller's check and the last message of
// this loop stand two awaits of its own (the setting and the Chrome permission)
// plus up to three create() calls, and a logout landing in that window runs
// clearAiredNotifications() BEFORE those messages exist — the tray then keeps
// `shikifav-aired:<id>` of a session that is over, and storage.session keeps its
// address. A notification is I/O to the outside world and cannot be recalled, so
// the fence is placed where it still decides something: immediately before each
// message and before the click targets are stored. What was already on screen
// when the session ended stays on screen; nothing new joins it.
export async function notifyAiredEpisodes(
    increases: readonly AiredIncrease[],
    items: readonly AiredPollItem[],
    stillOurs: () => Promise<boolean>,
): Promise<void> {
    if (increases.length === 0) {
        return;
    }
    let planned: AiredMessage[];
    let titleLang: TitleLang;
    try {
        const settings = await getSettings();
        if (!settings.episodeNotifications) {
            return;
        }
        // Asked after the setting and never before it: a profile that switched
        // notifications off must not have its permissions probed at all.
        if (!(await hasNotificationsPermission())) {
            return;
        }
        titleLang = settings.titleLang;
        planned = planAiredMessages(increases, items);
    } catch (e) {
        // Only the kind: the gates quote what they were given, and that carries
        // list data (CLAUDE.md rule 6).
        console.debug('[episode-notifications] failed to notify:', errorKind(e));
        return;
    }
    // Per message, and never around the loop. Around it, one row with a name
    // that is not a string silenced every OTHER title of the tick — and silenced
    // it for good, because the snapshot had already moved and those titles would
    // never show an increase again (прогон 2026-08-17).
    const shown: ShownNotification[] = [];
    for (const message of planned.slice(0, MAX_AIRED_NOTIFICATIONS_PER_TICK)) {
        // Asked before EVERY message, not once before the loop: three create()
        // calls are three windows, and a session can end inside any of them.
        if (!(await stillOurs())) {
            // Nothing is stored either — the click targets of the messages that
            // did get through belong to that session, and clearAuth() has
            // already dropped the map they would go into.
            return;
        }
        const entry = await showAiredNotification(message, titleLang);
        if (entry !== null) {
            shown.push(entry);
        }
    }
    await rememberClickTargets(shown, stillOurs);
}

// Pure: which increases can become a message at all. A row missing from the
// answer means there is no name to show — it cannot happen through diffAired
// (every increase comes from an observation of this very answer), and a message
// without a title is not worth the code that would guess one. An episode range
// that did not validate is dropped for the stronger reason: a message with an
// invented number is worse than no message.
function planAiredMessages(
    increases: readonly AiredIncrease[],
    items: readonly AiredPollItem[],
): AiredMessage[] {
    const byId = new Map(items.map((item) => [item.targetId, item]));
    const planned: AiredMessage[] = [];
    for (const increase of increases) {
        const item = byId.get(increase.targetId);
        const range = airedEpisodeRange(increase);
        if (item && range) {
            planned.push({ item, range });
        }
    }
    return planned;
}

// A message that made it to the tray, together with the address a click on it
// has to open. Returned instead of stored right here so that one storage write
// covers the whole tick.
interface ShownNotification {
    id: string;
    url: string;
}

async function showAiredNotification(
    { item, range }: AiredMessage,
    titleLang: TitleLang,
): Promise<ShownNotification | null> {
    const id = `${AIRED_NOTIFICATION_PREFIX}${item.targetId}`;
    try {
        // The name follows the `titleLang` setting, which the background did not
        // read at all before this task: otherwise the calendar would say
        // «Фрирен» and the notification «Sousou no Frieren» about the same title.
        const { primary } = displayTitle({ name: item.name, russian: item.russian }, titleLang);
        await browser.notifications.create(id, {
            type: 'basic',
            iconUrl: browser.runtime.getURL(NOTIFICATION_ICON),
            title: sanitizeNotificationTitle(primary),
            message: airedEpisodesMessage(range.first, range.last),
        });
    } catch (e) {
        console.debug('[episode-notifications] failed to show a notification:', errorKind(e));
        return null;
    }
    // Checked before it is stored, and once more on the click (Ф11-16): what
    // goes into storage is judged going in, and what comes out of storage is
    // judged coming out. The check is AFTER the message on purpose — a title
    // whose address the answer did not carry, or carried on a foreign host, is
    // still worth telling the user about; it just has nowhere to lead.
    const url = shikimoriHref(item.url);
    return url === null ? null : { id, url };
}

// One write per tick, and a prune with it. The tray is the only thing these
// entries are good for, so what is no longer in it is dropped — that is what
// keeps the map bounded (three entries per tick, forty-eight ticks a day)
// without any expiry logic of its own.
//
// The prune is UNCONDITIONAL (нит ревью). While an empty `shown` left early, a
// tick where no address passed the host guard — or where every message failed —
// pruned nothing, and the entries of messages long gone from the tray survived
// until the next tick that happened to store something. PRIVACY.md promises they
// are cut back on every new message; without this the promise held only
// sometimes. The invariant it buys is one line long: the map is never longer
// than the tray.
async function rememberClickTargets(
    shown: readonly ShownNotification[],
    stillOurs: () => Promise<boolean>,
): Promise<void> {
    try {
        const stored = await getSession('airedNotificationUrls');
        const live = await browser.notifications.getAll();
        const next: Record<string, string> = {};
        for (const [id, url] of Object.entries(stored ?? {})) {
            // Storage is untrusted input like everywhere else; the host is
            // checked again on the way out anyway.
            if (typeof url === 'string' && Object.hasOwn(live, id)) {
                next[id] = url;
            }
        }
        for (const { id, url } of shown) {
            next[id] = url;
        }
        // An empty map is no map: removing the key rather than writing `{}`
        // keeps «нет записей» one state instead of two, and a delete is safe
        // whatever the session is doing — hence it stands before the fence.
        if (Object.keys(next).length === 0) {
            await removeSession('airedNotificationUrls');
            return;
        }
        if (!(await stillOurs())) {
            return;
        }
        await setSession('airedNotificationUrls', next);
        if (!(await stillOurs())) {
            // The residual race the fence alone does not close, the same one the
            // snapshot has in the tick (src/lib/episode-watch.ts): a logout that
            // landed while this write was already on its way puts the addresses
            // back AFTER clearAuth() removed them, and titles of a finished
            // session then sit in storage.session until the next login.
            await removeSession('airedNotificationUrls');
        }
    } catch (e) {
        console.debug('[episode-notifications] failed to store the click targets:', errorKind(e));
    }
}

// Every message this module has put in the tray, taken back. Called when the
// session ends and when the feature is switched off: a notification carries the
// name of a title from the lists of whoever was logged in, and the system centre
// keeps it for as long as the user lets it — long past the logout.
//
// Total, and gated by the permission like everything else here: without the
// grant `browser.notifications` does not exist and every call would throw.
export async function clearAiredNotifications(): Promise<void> {
    try {
        // Before the permission gate and unconditionally: the click targets are
        // our own storage, they name titles from those lists just as the messages
        // do, and they must not outlive them even on a profile where the
        // notifications API is not available at all.
        await removeSession('airedNotificationUrls');
    } catch (e) {
        console.debug('[episode-notifications] failed to drop the click targets:', errorKind(e));
    }
    try {
        if (!(await hasNotificationsPermission())) {
            return;
        }
        const shown = await browser.notifications.getAll();
        for (const id of Object.keys(shown)) {
            // Ours only, by the same prefix the click handler recognises: other
            // extensions' messages are not ours to dismiss.
            if (id.startsWith(AIRED_NOTIFICATION_PREFIX)) {
                await browser.notifications.clear(id);
            }
        }
    } catch (e) {
        console.debug('[episode-notifications] failed to clear the tray:', errorKind(e));
    }
}

// Subscribed synchronously on every worker start, exactly like the alarm and the
// context menu: a click wakes the worker up and has to find the handler already
// attached. Wrapped in try/catch because the API itself is optional — on a
// profile that never granted the permission `browser.notifications` is not there
// to subscribe to, and that must not take the whole service worker down.
export function registerAiredNotificationClicks(): void {
    try {
        browser.notifications.onClicked.addListener((notificationId) => {
            void handleAiredNotificationClick(notificationId);
        });
    } catch (e) {
        console.debug('[episode-notifications] no notifications API:', errorKind(e));
    }
}

// A click means «покажи тайтл», nothing else: the notification carries no
// buttons and the background stays read-only (границы фазы 11) — «+1» and the
// status menu live in «Мои списки».
//
// The destination is the title page on Shikimori, not the extension (owner's
// decision 2026-08-17). `action.openPopup()` is refused from this event — Chrome
// throws (замер Ф11-3) — so the tab was going to be the only path anyway, and
// popup.html in a tab renders a 380 px column in the corner of an empty page.
// The address comes from the poll answer and is checked against our origins
// before the tab is opened.
export async function handleAiredNotificationClick(notificationId: string): Promise<void> {
    if (!notificationId.startsWith(AIRED_NOTIFICATION_PREFIX)) {
        return;
    }
    try {
        // The message has been answered; leaving it in the tray would mean the
        // user has to dismiss by hand what they just acted on.
        await browser.notifications.clear(notificationId);
    } catch (e) {
        console.debug('[episode-notifications] failed to close the notification:', errorKind(e));
    }
    const url = await clickTarget(notificationId);
    if (url === null) {
        return;
    }
    try {
        await browser.tabs.create({ url });
    } catch (e) {
        console.debug('[episode-notifications] failed to open the tab:', errorKind(e));
    }
}

// Where this notification leads, or null for «никуда». Null is a normal answer:
// the session cache is gone after a browser restart, the entry is dropped on
// logout with the rest of the session, and the answer may never have carried an
// address at all.
//
// The host is verified HERE, right before the tab, and not only when the entry
// was written: what is read back is a stored value, and this project treats
// stored values as untrusted input everywhere else too (sanitizeAiredSnapshot,
// sanitizeBadgeRows).
async function clickTarget(notificationId: string): Promise<string | null> {
    try {
        const stored = await getSession('airedNotificationUrls');
        return shikimoriHref(stored?.[notificationId]);
    } catch (e) {
        console.debug('[episode-notifications] failed to read the click target:', errorKind(e));
        return null;
    }
}

function errorKind(e: unknown): string {
    return e instanceof Error ? e.name : typeof e;
}
