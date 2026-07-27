import { browser } from 'wxt/browser';
import type { RateRow, SearchType, TitleCard, User, UserRateStatus } from './api/types';
import { DEFAULT_ORIGIN } from './config';
import type { Origin } from './config';

// All chrome.storage access goes ONLY through this module (docs/02-architecture.md).

export interface LocalState {
    auth?: {
        accessToken: string;
        refreshToken: string;
        expiresAt: number; // ms epoch, already with a -60s margin
        user: User;
    };
    settings: {
        origin: Origin;
        titleLang: 'ru' | 'romaji';
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
}

export const DEFAULT_SETTINGS: LocalState['settings'] = {
    origin: DEFAULT_ORIGIN,
    titleLang: 'ru',
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
