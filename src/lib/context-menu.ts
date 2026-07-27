import { browser } from 'wxt/browser';
import type { Browser } from 'wxt/browser';
import { i18n } from './i18n';
import { buildSearchPageUrl, sanitizeQuery } from './search-url';
import { removeSession, setSession } from './storage';

// US-8: select text on any page → "Найти «…» на Shikimori" → the extension
// popup opens and runs the search (owner decision Ф5-11). The full-screen
// search page stays as the fallback for a popup that refused to open.
// Registration happens on runtime.onInstalled (docs/02, §Background).

export const SEARCH_MENU_ID = 'shikifav-search-selection';

export async function registerContextMenu(): Promise<void> {
    try {
        // Menu items are persistent and outlive the service worker, so create()
        // with an existing id fails — removeAll() first makes this idempotent.
        await browser.contextMenus.removeAll();
        browser.contextMenus.create(
            {
                id: SEARCH_MENU_ID,
                // %s is substituted by Chrome itself for the selection context.
                title: i18n.contextMenu.searchSelection,
                contexts: ['selection'],
            },
            // create() reports failures through runtime.lastError instead of
            // throwing, and an unread lastError is logged by Chrome itself as
            // an "Unchecked runtime.lastError". Reading it here keeps a losing
            // race (onInstalled and onStartup in one session) quiet — the menu
            // still ends up with exactly one item either way.
            () => {
                const failure = browser.runtime.lastError;
                if (failure) {
                    console.debug('[context-menu] create reported:', failure.message);
                }
            },
        );
    } catch (e) {
        // A failed registration must not kill the service worker: everything
        // except the menu item keeps working.
        console.debug('[context-menu] failed to register the search item:', e);
    }
}

export async function handleMenuClick(info: Browser.contextMenus.OnClickData): Promise<void> {
    if (info.menuItemId !== SEARCH_MENU_ID) {
        return;
    }
    // A blank selection still opens the UI, just without a query (it shows its
    // hint) — a click that does nothing at all is worse.
    const query = sanitizeQuery(info.selectionText ?? '');
    try {
        // Awaited before openPopup(), never fire-and-forget: the popup reads
        // pendingSearch while mounting, so the write has to be committed before
        // the window can exist, otherwise the popup reads an empty key.
        if (query.length > 0) {
            await setSession('pendingSearch', { query });
        } else {
            // Nothing to hand over — and a key left by an earlier click must not
            // fire in a popup opened for a blank selection.
            await removeSession('pendingSearch');
        }
        // action.openPopup needs no extra permission (we already ship a
        // default_popup) and exists since Chrome 127. On an older build the
        // property is undefined and the call throws a TypeError, which lands in
        // the same fallback as a rejected promise (no active window, policy).
        await browser.action.openPopup();
    } catch (e) {
        // Covers a refused popup and, just as well, a failed session write —
        // both mean the query cannot reach the popup, so the page takes over.
        // Only the error kind is logged: openPopup and tabs.create quote what
        // they rejected, and that can carry the selected text (CLAUDE.md rule 6).
        console.debug('[context-menu] failed to open the popup:', errorKind(e));
        await openSearchTab(query);
    }
}

// Fallback path: the full-screen search page in a new tab, exactly as this
// worked before Ф5-11.
async function openSearchTab(query: string): Promise<void> {
    try {
        // The pending query belongs to a popup that never opened; left behind,
        // it would fire on the next manual open, long after this click.
        await removeSession('pendingSearch');
    } catch (e) {
        console.debug('[context-menu] failed to drop the pending search:', errorKind(e));
    }
    try {
        await browser.tabs.create({ url: buildSearchPageUrl(query) });
    } catch (e) {
        console.debug('[context-menu] failed to open the search tab:', errorKind(e));
    }
}

function errorKind(e: unknown): string {
    return e instanceof Error ? e.name : typeof e;
}
