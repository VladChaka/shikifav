import { browser } from 'wxt/browser';
import { DEFAULT_SETTINGS, getSettings } from './storage';
import type { Theme } from './storage';

// Runtime half of the theme (Ф6-19): src/styles/foundation.scss keys the
// explicit themes on this attribute of <html>, 'system' is its absence.
const THEME_ATTR = 'data-theme';

// Only the two methods this module needs from <html>: unit tests run in the
// DOM-less node environment (vitest.config.ts) and pass a stub instead.
export interface ThemeRoot {
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
}

export function applyTheme(theme: Theme, root: ThemeRoot): void {
    if (theme === 'system') {
        root.removeAttribute(THEME_ATTR);
        return;
    }
    root.setAttribute(THEME_ATTR, theme);
}

let subscribed = false;

// Re-read instead of parsing change.newValue: getSettings() owns the per-key
// fallback to the defaults (same reason as use-settings.ts).
function subscribe(root: ThemeRoot): void {
    if (subscribed) {
        return;
    }
    subscribed = true;
    browser.storage.local.onChanged.addListener((changes) => {
        if (!('settings' in changes)) {
            return;
        }
        void getSettings()
            .then((settings) => {
                applyTheme(settings.theme, root);
            })
            // Never rejects, same as initTheme. Here the fallback is to change
            // nothing: unlike the first apply, a theme is already on <html> and
            // repainting the page as 'system' because of a failed read would be
            // a worse answer than keeping the last known one.
            .catch(() => {});
    });
}

// Awaited before mount() in every entrypoint: an explicit light/dark choice
// must be on <html> before the first frame, otherwise the page flashes the
// system theme. Costs one chrome.storage.local read — not a network call, so
// the "no blocking requests on popup open" budget (docs/05) still holds.
// Never rejects: a failed read must not leave a page unmounted, and the system
// theme is a valid fallback.
export async function initTheme(root: ThemeRoot = document.documentElement): Promise<void> {
    const theme = await getSettings()
        .then((settings) => settings.theme)
        .catch(() => DEFAULT_SETTINGS.theme);
    applyTheme(theme, root);
    // Subscribed after the first apply so a long-lived search tab follows a
    // change made on the options page without a reload.
    subscribe(root);
}
