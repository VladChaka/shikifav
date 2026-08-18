import { browser } from 'wxt/browser';
import { ONGOING_MYLIST_STATUSES } from './api/graphql';
import type { RateState } from './api/types';
import { badgeText, withRateProgress, withoutRate } from './badge-backlog';
import type { BadgeRow } from './badge-backlog';
import { countTitlesBehind } from './calendar-schedule';
import { badgeTitleMessage } from './i18n';
import { clearBadgeBacklog, getBadgeBacklog, setBadgeBacklog } from './storage';

// The badge on the extension icon (US-12, Ф11-9): the only module that draws on
// browser.action. Background-only, like everything that writes to the icon.
// «Draws», not «touches»: context-menu.ts also calls browser.action, but only
// openPopup() — it never sets text, colour or title, so the icon's visible state
// still has exactly one author.
//
// Every entry point below is total: it never rejects, and it never leaves the
// stored rows and the drawn number disagreeing (both are written in one place,
// render()). A failing badge must not fail a user's write or take the tick down
// with it — it is decoration on top of an action that already succeeded.

// The light `--color-accent`. Both colours are set EXPLICITLY on every draw and
// the same pair is used for either browser theme: the icon carries its own white
// sheet, so a badge tuned for a dark panel would sit wrong on the icon itself.
// Chrome's own default is a red that means "error" nowhere in this extension.
const BADGE_BACKGROUND_COLOR = '#1a7f5a';
const BADGE_TEXT_COLOR = '#ffffff';

// Rows the poll just saw, in poll order. Replaces the stored list wholesale: it
// is rebuilt from the current answer every tick, exactly like the airing
// snapshot, so a title that left the lists cannot linger in the count.
export async function showAiredBacklog(rows: readonly BadgeRow[]): Promise<void> {
    await guarded(async () => {
        await setBadgeBacklog(rows);
        await render(countTitlesBehind(rows));
    });
}

// Logout, a session lost inside the tick, the feature switched off, an empty
// answer — every one of them is "nothing waits". The rows go too: a number from
// a previous account must not be restorable on the next service worker start.
//
// The order and the two guards are the point (Ф11 audit). The number is what the
// user sees, so it goes out FIRST and in a guard of its own: with both steps
// under one guard, a storage delete that was refused — quota, a profile being
// wiped, an extension being disabled — used to skip the redraw and leave the
// count of a session that is over on the icon.
export async function clearBadge(): Promise<void> {
    await guarded(() => render(0));
    await guarded(() => clearBadgeBacklog());
}

// Called on every service worker start. Whether badge text survives the death of
// the worker is not measured yet (Ф11-3), so it is restored unconditionally:
// redrawing a number we already have costs a storage read, while the opposite
// mistake shows an empty icon to someone who has episodes waiting. Never a
// request — a wake-up must not become network (docs/05).
export async function restoreBadge(): Promise<void> {
    await guarded(async () => {
        await render(countTitlesBehind(await getBadgeBacklog()));
    });
}

// A write from the popup came back (create/update/increment). The answer carries
// the new progress and the new status of ONE rate, which is everything the badge
// needs to recount without asking Shikimori again — that is what makes the
// counter fade as episodes are marked, instead of half an hour later (US-12).
//
// A status outside the polled set drops the row: «Просмотрено» and «Брошено» are
// not what the poll reads, so such a title stops being counted the moment the
// server confirms the move — the same rule the next tick would apply anyway.
export async function applyRateWrite(rate: RateState): Promise<void> {
    await updateRows((rows) =>
        ONGOING_MYLIST_STATUSES.includes(rate.status)
            ? withRateProgress(rows, rate.id, rate.episodes)
            : withoutRate(rows, rate.id),
    );
}

// The rate was deleted from the lists: the title cannot be behind on anything.
export async function forgetRate(rateId: string): Promise<void> {
    await updateRows((rows) => withoutRate(rows, rateId));
}

// Shared body of the two write hooks. The identity check is what keeps a write
// about a title the badge does not count (a manga, an old rate, anything from
// outside the poll) from costing a storage write and a redraw.
async function updateRows(
    patch: (rows: readonly BadgeRow[]) => readonly BadgeRow[],
): Promise<void> {
    await guarded(async () => {
        const rows = await getBadgeBacklog();
        const next = patch(rows);
        if (next === rows) {
            return;
        }
        await setBadgeBacklog(next);
        await render(countTitlesBehind(next));
    });
}

async function render(count: number): Promise<void> {
    await browser.action.setBadgeText({ text: badgeText(count) });
    await browser.action.setBadgeBackgroundColor({ color: BADGE_BACKGROUND_COLOR });
    await browser.action.setBadgeTextColor({ color: BADGE_TEXT_COLOR });
    // The tooltip carries the exact number even when the badge is capped at 99+.
    await browser.action.setTitle({ title: badgeTitleMessage(count) });
}

// Only the kind of the failure is logged: storage rejections quote what they
// were given, and that is list data (CLAUDE.md rule 6).
async function guarded(update: () => Promise<void>): Promise<void> {
    try {
        await update();
    } catch (e) {
        console.debug('[badge] update failed:', e instanceof Error ? e.name : typeof e);
    }
}
