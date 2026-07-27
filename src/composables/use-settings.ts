import { ref } from 'vue';
import type { Ref } from 'vue';
import { browser } from 'wxt/browser';
import { DEFAULT_SETTINGS, getSettings } from '../lib/storage';
import type { LocalState } from '../lib/storage';

export interface UseSettings {
    settings: Ref<LocalState['settings']>;
}

// Module-level state: every component of a page shares one settings snapshot
// (same pattern as use-auth/use-search). Reading storage directly instead of
// asking background is deliberate: CLAUDE.md rule 1 restricts network, not
// storage, and an extra message would wake the service worker on every popup
// open, against the popup open-time budget (docs/05).
//
// Starts at the defaults, so the very first frame already renders the
// documented default (titleLang 'ru') and the async read below only has to
// correct a non-default profile.
const settings = ref<LocalState['settings']>({ ...DEFAULT_SETTINGS });

let initialized = false;

// Never rejects (same rule as src/lib/theme.ts): a failed storage read must not
// break the page that initialises this composable, and the snapshot already in
// the ref — the defaults on the first load — stays a valid thing to render.
async function load(): Promise<void> {
    settings.value = await getSettings().catch(() => settings.value);
}

// Re-read instead of parsing change.newValue: getSettings() owns the per-key
// fallback to the defaults, and a partially written object must not leak an
// undefined value into the UI.
function subscribe(): void {
    browser.storage.local.onChanged.addListener((changes) => {
        if ('settings' in changes) {
            void load();
        }
    });
}

export function useSettings(): UseSettings {
    if (!initialized) {
        initialized = true;
        void load();
        // A long-lived search tab must follow a change made on the options
        // page; there is no teardown because the state lives as long as the page.
        subscribe();
    }
    return { settings };
}
