import { browser } from 'wxt/browser';
import type { Browser } from 'wxt/browser';
import { i18n } from './i18n';
import { buildSearchPageUrl } from './search-url';

// US-8: select text on any page → "Найти «…» на Shikimori" → the extension
// search page opens in a new tab with the query already applied. Registration
// happens on runtime.onInstalled (docs/02, §Background).

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
    try {
        // A blank selection still opens the page, just without `q` (the page
        // shows its hint) — a click that does nothing at all is worse.
        await browser.tabs.create({ url: buildSearchPageUrl(info.selectionText ?? '') });
    } catch (e) {
        // Only the error kind is logged: a tabs.create failure quotes the URL it
        // rejected, and that URL carries the selected text (CLAUDE.md rule 6).
        console.debug(
            '[context-menu] failed to open the search tab:',
            e instanceof Error ? e.name : typeof e,
        );
    }
}
