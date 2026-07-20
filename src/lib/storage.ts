import { browser } from 'wxt/browser';
import type { Origin } from './config';

// All chrome.storage access goes ONLY through this module (docs/02-architecture.md).

export interface LocalState {
    auth?: {
        accessToken: string;
        refreshToken: string;
        expiresAt: number; // ms epoch, already with a -60s margin
        user: { id: number; nickname: string; avatarUrl: string };
    };
    settings: {
        origin: Origin;
        titleLang: 'ru' | 'romaji';
    };
}

// chrome.storage.session — live cache, safe to lose (docs/02-architecture.md).
// Search/lists cache keys are added in phase 2+.
export interface SessionState {
    // Last opened popup tab: «Поиск» / «Мои списки» (docs/05-ui.md).
    lastTab?: 'search' | 'lists';
}

export const DEFAULT_SETTINGS: LocalState['settings'] = {
    origin: 'https://shikimori.one',
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
