import { browser } from 'wxt/browser';
import type {
    CalendarItem,
    RateRow,
    SearchType,
    TitleCard,
    User,
    UserRateStatus,
} from './api/types';
import { DEFAULT_ORIGIN } from './config';
import type { Origin } from './config';

// All chrome.storage access goes ONLY through this module (docs/02-architecture.md).

// UI-level settings vocabulary (docs/05-ui.md). Declared next to the schema so
// consumers (lib/theme.ts, the options page) share one definition instead of
// importing each other.
export type Theme = 'system' | 'light' | 'dark';
// 'last' = restore the tab the popup was closed on (session.lastTab).
export type StartTab = 'search' | 'lists' | 'last';

export interface LocalState {
    auth?: {
        accessToken: string;
        refreshToken: string;
        expiresAt: number; // ms epoch, already with a -60s margin
        user: User;
    };
    // Every default below reproduces the behaviour the extension had before the
    // setting existed, so an untouched profile sees no change (Ф6-19).
    settings: {
        origin: Origin;
        titleLang: 'ru' | 'romaji';
        theme: Theme;
        startTab: StartTab;
        quickStatus: UserRateStatus; // one-click add button on a search card
        defaultSearchType: SearchType;
        defaultListStatus: UserRateStatus; // status filter of "Мои списки"
    };
}

// chrome.storage.session — live cache, safe to lose (docs/02-architecture.md).
export interface SessionState {
    // Last opened popup tab: «Поиск» / «Мои списки» (docs/05-ui.md).
    lastTab?: 'search' | 'lists';
    // Last search results for the instant first render of the popup (docs/05-ui.md).
    // type keeps the Аниме/Манга/Ранобэ selector in sync with restored items.
    lastSearch?: { query: string; type: SearchType; items: TitleCard[] };
    // Query handed over by the context menu to the popup it opens (Ф5-11).
    // Written right before browser.action.openPopup() and consumed exactly once:
    // the popup removes the key as soon as it reads it.
    pendingSearch?: { query: string };
    // Last opened "My lists" filter+page for the instant first render (docs/05).
    // Only the last-viewed (type,status) combo is cached — mirrors lastSearch.
    lastList?: {
        type: SearchType;
        status: UserRateStatus;
        items: RateRow[];
        page: number;
        hasMore: boolean;
    };
    // Last loaded ongoings calendar for the instant first frame of the tab (Ф7-7).
    // Rows only — never the built schedule: the day groups depend on the current
    // clock, so a cached «Сегодня» would show yesterday's air time under today's
    // header. `fetchedAt` is diagnostics/«обновлено …», not a TTL: the tab
    // refreshes on every show (docs/06).
    lastCalendar?: { items: CalendarItem[]; fetchedAt: number };
}

export const DEFAULT_SETTINGS: LocalState['settings'] = {
    origin: DEFAULT_ORIGIN,
    titleLang: 'ru',
    theme: 'system',
    startTab: 'last',
    quickStatus: 'planned',
    defaultSearchType: 'anime',
    defaultListStatus: 'watching',
};

export async function getLocal<K extends keyof LocalState>(
    key: K,
): Promise<LocalState[K] | undefined> {
    const result = await browser.storage.local.get(key);
    return result[key] as LocalState[K] | undefined;
}

export async function setLocal<K extends keyof LocalState>(
    key: K,
    value: LocalState[K],
): Promise<void> {
    await browser.storage.local.set({ [key]: value });
}

export async function removeLocal<K extends keyof LocalState>(key: K): Promise<void> {
    await browser.storage.local.remove(key);
}

// Single source of truth for settings: every reader goes through getSettings()
// instead of getLocal('settings') ?? DEFAULT_SETTINGS. The stored object is
// treated as partial on purpose — a build that wrote fewer keys (or a patch
// that touched one of them) must not surface undefined where a value is
// expected, so defaults are applied per key, not to the object as a whole.
export async function getSettings(): Promise<LocalState['settings']> {
    const stored = (await getLocal('settings')) as Partial<LocalState['settings']> | undefined;
    return {
        origin: stored?.origin ?? DEFAULT_SETTINGS.origin,
        titleLang: stored?.titleLang ?? DEFAULT_SETTINGS.titleLang,
        theme: stored?.theme ?? DEFAULT_SETTINGS.theme,
        startTab: stored?.startTab ?? DEFAULT_SETTINGS.startTab,
        quickStatus: stored?.quickStatus ?? DEFAULT_SETTINGS.quickStatus,
        defaultSearchType: stored?.defaultSearchType ?? DEFAULT_SETTINGS.defaultSearchType,
        defaultListStatus: stored?.defaultListStatus ?? DEFAULT_SETTINGS.defaultListStatus,
    };
}

// Patch semantics: an omitted key (or an explicitly undefined one — Partial
// allows it) keeps its current value, so a UI that owns a single setting cannot
// wipe the rest.
export async function setSettings(patch: Partial<LocalState['settings']>): Promise<void> {
    const current = await getSettings();
    await setLocal('settings', {
        origin: patch.origin ?? current.origin,
        titleLang: patch.titleLang ?? current.titleLang,
        theme: patch.theme ?? current.theme,
        startTab: patch.startTab ?? current.startTab,
        quickStatus: patch.quickStatus ?? current.quickStatus,
        defaultSearchType: patch.defaultSearchType ?? current.defaultSearchType,
        defaultListStatus: patch.defaultListStatus ?? current.defaultListStatus,
    });
}

export async function getSession<K extends keyof SessionState>(
    key: K,
): Promise<SessionState[K] | undefined> {
    const result = await browser.storage.session.get(key);
    return result[key] as SessionState[K] | undefined;
}

export async function setSession<K extends keyof SessionState>(
    key: K,
    value: SessionState[K],
): Promise<void> {
    await browser.storage.session.set({ [key]: value });
}

export async function removeSession<K extends keyof SessionState>(key: K): Promise<void> {
    await browser.storage.session.remove(key);
}

// The session cache may hold personal data (lists, search with userRate), so it
// is wiped together with auth on logout (docs/04-auth.md §4).
export async function clearSession(): Promise<void> {
    await browser.storage.session.clear();
}
