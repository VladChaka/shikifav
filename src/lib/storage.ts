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

// Top-level popup tabs, in the order TabBar renders them (Ф7-9). Declared here
// rather than in the component because storage is where the two persisted tab
// values live — `session.lastTab` and the `startTab` setting — and both must be
// validated against exactly this list.
export const POPUP_TABS = ['search', 'lists', 'calendar'] as const;
export type PopupTab = (typeof POPUP_TABS)[number];

// 'last' = restore the tab the popup was closed on (session.lastTab).
export type StartTab = PopupTab | 'last';

// Where an unknown persisted tab lands: «Поиск» is the one tab that always
// exists and opens with no data of its own.
export const FALLBACK_TAB: PopupTab = 'search';

// Anything read back from storage is untrusted input: a profile written by
// another build (or by a later one, before a downgrade) can hold a tab this
// build knows nothing about. Rendering it would leave the popup with no active
// tab at all, so unknown values are dropped by these guards and the caller
// falls back to FALLBACK_TAB.
export function isPopupTab(value: unknown): value is PopupTab {
    return (POPUP_TABS as readonly string[]).includes(value as string);
}

function isStartTab(value: unknown): value is StartTab {
    return value === 'last' || isPopupTab(value);
}

// Sections of the options page, in the order OptionsPage renders them (Ф8-3).
// Declared here for the same reason as POPUP_TABS: the section handed over
// through `session.pendingOptionsSection` is a persisted value and has to be
// validated against exactly this list.
export const OPTIONS_SECTIONS = ['view', 'behavior', 'account', 'support'] as const;
export type OptionsSection = (typeof OPTIONS_SECTIONS)[number];

// Where an unknown handover lands: «Вид» is the section the page always opens
// on, and it needs no data of its own.
export const FALLBACK_OPTIONS_SECTION: OptionsSection = 'view';

export function isOptionsSection(value: unknown): value is OptionsSection {
    return (OPTIONS_SECTIONS as readonly string[]).includes(value as string);
}

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
    // Last opened popup tab: «Поиск» / «Мои списки» / «Календарь» (docs/05-ui.md).
    lastTab?: PopupTab;
    // Last search results for the instant first render of the popup (docs/05-ui.md).
    // type keeps the Аниме/Манга/Ранобэ selector in sync with restored items.
    lastSearch?: { query: string; type: SearchType; items: TitleCard[] };
    // Query handed over by the context menu to the popup it opens (Ф5-11).
    // Written right before browser.action.openPopup() and consumed exactly once:
    // the popup removes the key as soon as it reads it.
    pendingSearch?: { query: string };
    // Section the options page must open on, handed over by «Поддержать проект»
    // in the popup header (Ф8-3). Written right before openOptionsPage() and
    // consumed exactly once: the page removes the key as soon as it reads it.
    // A storage key rather than a URL hash because openOptionsPage() focuses an
    // ALREADY open options tab without reloading it — a hash would be ignored
    // there, while a key also reaches that tab through storage.onChanged.
    pendingOptionsSection?: OptionsSection;
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

// The only setting checked against its vocabulary and not merely against
// undefined: it decides which tab the popup opens on, and an unknown value
// would open none. Two different fallbacks on purpose — a missing key is the
// documented default ('last', restore the cached tab), while a value from a
// vocabulary this build does not have carries no restorable intent and goes
// straight to «Поиск».
function readStartTab(value: unknown): StartTab {
    if (value === undefined) {
        return DEFAULT_SETTINGS.startTab;
    }
    return isStartTab(value) ? value : FALLBACK_TAB;
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
        startTab: readStartTab(stored?.startTab),
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
