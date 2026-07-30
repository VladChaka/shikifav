import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import {
    clearSession,
    DEFAULT_SETTINGS,
    FALLBACK_OPTIONS_SECTION,
    getLocal,
    getSession,
    getSettings,
    isOptionsSection,
    OPTIONS_SECTIONS,
    removeLocal,
    removeSession,
    setLocal,
    setSession,
    setSettings,
} from './storage';
import type { LocalState, SessionState } from './storage';
import { ORIGINS } from './config';

// One non-default value per key added in Ф6-19: reused for the read side
// (a stored value must survive the per-key merge) and for the write side
// (a one-key patch must not disturb the rest).
const NON_DEFAULT_VALUES: Array<[string, Partial<LocalState['settings']>]> = [
    ['theme', { theme: 'dark' }],
    ['startTab', { startTab: 'search' }],
    ['quickStatus', { quickStatus: 'completed' }],
    ['defaultSearchType', { defaultSearchType: 'ranobe' }],
    ['defaultListStatus', { defaultListStatus: 'dropped' }],
];

describe('storage', () => {
    beforeEach(() => {
        fakeBrowser.reset();
    });

    describe('DEFAULT_SETTINGS', () => {
        // Pins the documented defaults (docs/02-architecture.md, task 11):
        // breaking any value must fail this test. The Ф6-19 keys are pinned for
        // a second reason — each default reproduces the behaviour the extension
        // had before the setting existed.
        it('matches the documented defaults', () => {
            expect(DEFAULT_SETTINGS).toEqual({
                origin: 'https://shikimori.io',
                titleLang: 'ru',
                theme: 'system',
                startTab: 'last',
                quickStatus: 'planned',
                defaultSearchType: 'anime',
                defaultListStatus: 'watching',
                // Opt-out by decision of the owner (фаза 10): on unless turned
                // off. The one default here that is not "behave as before the
                // setting existed" — see docs/06.
                analytics: true,
            });
        });

        it('uses an origin from the allowed ORIGINS list', () => {
            expect(ORIGINS).toContain(DEFAULT_SETTINGS.origin);
        });
    });

    describe('getLocal / setLocal', () => {
        it('returns undefined for settings on empty storage (callers fall back to DEFAULT_SETTINGS)', async () => {
            const settings = await getLocal('settings');
            expect(settings).toBeUndefined();
            // The consumer pattern documented for phase 0: nullish fallback to defaults.
            expect(settings ?? DEFAULT_SETTINGS).toEqual(DEFAULT_SETTINGS);
        });

        it('round-trips settings', async () => {
            const settings: LocalState['settings'] = {
                ...DEFAULT_SETTINGS,
                origin: 'https://shikimori.io',
                titleLang: 'romaji',
            };
            await setLocal('settings', settings);
            await expect(getLocal('settings')).resolves.toEqual(settings);
        });

        it('round-trips the nested auth object', async () => {
            const auth: LocalState['auth'] = {
                accessToken: 'access-token',
                refreshToken: 'refresh-token',
                expiresAt: 1_800_000_000_000,
                user: { id: 42, nickname: 'tester', avatarUrl: 'https://example.test/a.png' },
            };
            await setLocal('auth', auth);
            await expect(getLocal('auth')).resolves.toEqual(auth);
        });

        it('removeLocal deletes only the given key', async () => {
            await setLocal('auth', {
                accessToken: 'a',
                refreshToken: 'r',
                expiresAt: 0,
                user: { id: 1, nickname: 'n', avatarUrl: '' },
            });
            await setLocal('settings', DEFAULT_SETTINGS);

            await removeLocal('auth');

            await expect(getLocal('auth')).resolves.toBeUndefined();
            await expect(getLocal('settings')).resolves.toEqual(DEFAULT_SETTINGS);
        });

        it('keeps keys independent: writing auth does not affect settings', async () => {
            await setLocal('auth', {
                accessToken: 'a',
                refreshToken: 'r',
                expiresAt: 0,
                user: { id: 1, nickname: 'n', avatarUrl: '' },
            });
            await expect(getLocal('settings')).resolves.toBeUndefined();
        });
    });

    describe('getSettings / setSettings', () => {
        // The typed wrapper cannot express an incomplete settings object, but
        // storage can hold one: a build that knew fewer keys, or a key added
        // later, leaves exactly this shape behind.
        async function writeRawSettings(value: Record<string, unknown>): Promise<void> {
            await fakeBrowser.storage.local.set({ settings: value });
        }

        it('returns the defaults on empty storage', async () => {
            await expect(getSettings()).resolves.toEqual(DEFAULT_SETTINGS);
        });

        it('returns the stored values when every key is present', async () => {
            const stored: LocalState['settings'] = {
                origin: 'https://shikimori.one',
                titleLang: 'romaji',
                theme: 'dark',
                startTab: 'search',
                quickStatus: 'watching',
                defaultSearchType: 'manga',
                defaultListStatus: 'completed',
                analytics: false,
            };
            await setLocal('settings', stored);
            await expect(getSettings()).resolves.toEqual(stored);
        });

        it('fills a missing titleLang from the defaults, keeping the stored origin', async () => {
            await writeRawSettings({ origin: 'https://shikimori.one' });
            await expect(getSettings()).resolves.toEqual({
                ...DEFAULT_SETTINGS,
                origin: 'https://shikimori.one',
            });
        });

        it('fills a missing origin from the defaults, keeping the stored titleLang', async () => {
            await writeRawSettings({ titleLang: 'romaji' });
            await expect(getSettings()).resolves.toEqual({
                ...DEFAULT_SETTINGS,
                titleLang: 'romaji',
            });
        });

        // The exact shape a profile carries after updating from a build that
        // predates Ф6-19: the appearance/behaviour keys are simply absent.
        it('fills every key added later from the defaults', async () => {
            await writeRawSettings({ origin: 'https://shikimori.one', titleLang: 'romaji' });

            const settings = await getSettings();

            expect(settings).toEqual({
                ...DEFAULT_SETTINGS,
                origin: 'https://shikimori.one',
                titleLang: 'romaji',
            });
        });

        it.each(NON_DEFAULT_VALUES)(
            'reads a stored %s while defaulting the rest',
            async (_key, stored) => {
                await writeRawSettings({ ...stored });

                await expect(getSettings()).resolves.toEqual({ ...DEFAULT_SETTINGS, ...stored });
            },
        );

        it('never returns undefined for a key of a partially written object', async () => {
            await writeRawSettings({ titleLang: 'romaji' });
            const settings = await getSettings();
            // The whole point of the per-key merge: callers index these blindly.
            for (const key of Object.keys(DEFAULT_SETTINGS)) {
                expect(settings[key as keyof LocalState['settings']]).toBeDefined();
            }
        });

        it('falls back to the defaults for an empty stored object', async () => {
            await writeRawSettings({});
            await expect(getSettings()).resolves.toEqual(DEFAULT_SETTINGS);
        });

        // Ф7-9: startTab decides which tab the popup opens on, so it is the one
        // key checked against its vocabulary and not merely against undefined —
        // an unknown tab (a profile from another build) would open none.
        it('replaces an unknown startTab with «Поиск», not with the default', async () => {
            await writeRawSettings({ startTab: 'timeline' });
            const settings = await getSettings();
            expect(settings.startTab).toBe('search');
            // The documented default ('last') stays the answer for a MISSING
            // key: only a value from a vocabulary this build lacks is dropped.
            expect(DEFAULT_SETTINGS.startTab).toBe('last');
        });

        it('keeps every known startTab value, including the third tab', async () => {
            for (const startTab of ['search', 'lists', 'calendar', 'last'] as const) {
                await writeRawSettings({ startTab });
                await expect(getSettings()).resolves.toEqual({ ...DEFAULT_SETTINGS, startTab });
            }
        });

        it('setSettings patches one key and keeps the other', async () => {
            await setLocal('settings', { ...DEFAULT_SETTINGS, titleLang: 'romaji' });

            await setSettings({ origin: 'https://shikimori.one' });

            await expect(getSettings()).resolves.toEqual({
                ...DEFAULT_SETTINGS,
                origin: 'https://shikimori.one',
                titleLang: 'romaji',
            });
        });

        it('setSettings on empty storage writes a complete object', async () => {
            await setSettings({ titleLang: 'romaji' });

            await expect(getLocal('settings')).resolves.toEqual({
                ...DEFAULT_SETTINGS,
                titleLang: 'romaji',
            });
        });

        it('setSettings completes the keys missing from a partially written object', async () => {
            await writeRawSettings({ titleLang: 'romaji' });

            await setSettings({ origin: 'https://shikimori.one' });

            await expect(getLocal('settings')).resolves.toEqual({
                ...DEFAULT_SETTINGS,
                origin: 'https://shikimori.one',
                titleLang: 'romaji',
            });
        });

        it('setSettings ignores an explicitly undefined value in the patch', async () => {
            await setLocal('settings', { ...DEFAULT_SETTINGS, origin: 'https://shikimori.one' });

            await setSettings({ origin: undefined });

            await expect(getSettings()).resolves.toEqual({
                ...DEFAULT_SETTINGS,
                origin: 'https://shikimori.one',
            });
        });

        // Each new key owns a control of its own on the options page, so a
        // single-setting UI must write it without knowing about the others.
        it.each(NON_DEFAULT_VALUES)('setSettings patches %s alone', async (_key, patch) => {
            await setSettings({ titleLang: 'romaji' });

            await setSettings(patch);

            await expect(getSettings()).resolves.toEqual({
                ...DEFAULT_SETTINGS,
                titleLang: 'romaji',
                ...patch,
            });
        });

        it('setSettings does not touch auth', async () => {
            const auth: LocalState['auth'] = {
                accessToken: 'a',
                refreshToken: 'r',
                expiresAt: 0,
                user: { id: 1, nickname: 'n', avatarUrl: '' },
            };
            await setLocal('auth', auth);

            await setSettings({ origin: 'https://shikimori.one' });

            await expect(getLocal('auth')).resolves.toEqual(auth);
        });
    });

    describe('getSession / setSession', () => {
        it('returns undefined for lastTab on empty storage', async () => {
            await expect(getSession('lastTab')).resolves.toBeUndefined();
        });

        it('round-trips lastTab', async () => {
            const lastTab: SessionState['lastTab'] = 'lists';
            await setSession('lastTab', lastTab);
            await expect(getSession('lastTab')).resolves.toBe('lists');
        });

        // Ф5-11: the context menu writes the selection here right before opening
        // the popup, and the popup consumes it exactly once.
        it('round-trips pendingSearch', async () => {
            const pending: SessionState['pendingSearch'] = { query: 'Стальной алхимик & Co' };
            await setSession('pendingSearch', pending);
            await expect(getSession('pendingSearch')).resolves.toEqual(pending);
        });

        it('returns undefined for pendingSearch on empty storage (no handover pending)', async () => {
            await expect(getSession('pendingSearch')).resolves.toBeUndefined();
        });

        // Ф8-3: the heart button in the popup header writes the section here
        // right before openOptionsPage(), and the options page consumes it once.
        it('round-trips pendingOptionsSection', async () => {
            await setSession('pendingOptionsSection', 'support');
            await expect(getSession('pendingOptionsSection')).resolves.toBe('support');
        });

        it('returns undefined for pendingOptionsSection on empty storage', async () => {
            await expect(getSession('pendingOptionsSection')).resolves.toBeUndefined();
        });

        it('drops pendingOptionsSection alone, leaving the rest of the cache', async () => {
            await setSession('pendingOptionsSection', 'support');
            await setSession('lastTab', 'lists');

            await removeSession('pendingOptionsSection');

            await expect(getSession('pendingOptionsSection')).resolves.toBeUndefined();
            await expect(getSession('lastTab')).resolves.toBe('lists');
        });

        it('clearSession wipes the session area but not local', async () => {
            await setSession('lastTab', 'search');
            // A pending selection is personal data too and must not survive logout.
            await setSession('pendingSearch', { query: 'берсерк' });
            await setSession('pendingOptionsSection', 'support');
            await setLocal('settings', DEFAULT_SETTINGS);

            await clearSession();

            await expect(getSession('lastTab')).resolves.toBeUndefined();
            await expect(getSession('pendingSearch')).resolves.toBeUndefined();
            await expect(getSession('pendingOptionsSection')).resolves.toBeUndefined();
            await expect(getLocal('settings')).resolves.toEqual(DEFAULT_SETTINGS);
        });
    });

    // Ф8-3: the handed-over section comes back from storage as untrusted input,
    // exactly like the persisted popup tabs (Ф7-9).
    describe('options sections', () => {
        it('accepts every section the options page renders', () => {
            for (const section of OPTIONS_SECTIONS) {
                expect(isOptionsSection(section)).toBe(true);
            }
        });

        it.each([['timeline'], [''], [undefined], [null], [42], [{ id: 'support' }]])(
            'rejects %s as a section',
            (value) => {
                expect(isOptionsSection(value)).toBe(false);
            },
        );

        it('falls back to a section that exists', () => {
            expect(OPTIONS_SECTIONS).toContain(FALLBACK_OPTIONS_SECTION);
        });
    });

    describe('removeSession', () => {
        it('deletes only the given key', async () => {
            await setSession('pendingSearch', { query: 'берсерк' });
            await setSession('lastTab', 'lists');

            await removeSession('pendingSearch');

            await expect(getSession('pendingSearch')).resolves.toBeUndefined();
            await expect(getSession('lastTab')).resolves.toBe('lists');
        });

        it('resolves on a key that was never written (callers remove blindly)', async () => {
            await expect(removeSession('pendingSearch')).resolves.toBeUndefined();
            await expect(getSession('pendingSearch')).resolves.toBeUndefined();
        });

        it('is idempotent: removing twice is still a no-op', async () => {
            await setSession('pendingSearch', { query: 'берсерк' });

            await removeSession('pendingSearch');
            await expect(removeSession('pendingSearch')).resolves.toBeUndefined();

            await expect(getSession('pendingSearch')).resolves.toBeUndefined();
        });

        it('does not touch the local area', async () => {
            await setLocal('settings', DEFAULT_SETTINGS);
            await fakeBrowser.storage.local.set({ pendingSearch: { query: 'берсерк' } });

            await removeSession('pendingSearch');

            const local = await fakeBrowser.storage.local.get('pendingSearch');
            expect(local['pendingSearch']).toEqual({ query: 'берсерк' });
        });
    });

    describe('area isolation', () => {
        it('does not leak session writes into local storage', async () => {
            await setSession('lastTab', 'search');
            const local = await fakeBrowser.storage.local.get('lastTab');
            expect(local['lastTab']).toBeUndefined();
        });

        it('does not leak local writes into session storage', async () => {
            await setLocal('settings', DEFAULT_SETTINGS);
            const session = await fakeBrowser.storage.session.get('settings');
            expect(session['settings']).toBeUndefined();
        });
    });
});
