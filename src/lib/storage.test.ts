import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import {
    clearSession,
    DEFAULT_SETTINGS,
    getLocal,
    getSession,
    removeLocal,
    removeSession,
    setLocal,
    setSession,
} from './storage';
import type { LocalState, SessionState } from './storage';
import { ORIGINS } from './config';

describe('storage', () => {
    beforeEach(() => {
        fakeBrowser.reset();
    });

    describe('DEFAULT_SETTINGS', () => {
        // Pins the documented defaults (docs/02-architecture.md, task 11):
        // breaking either value must fail this test.
        it('matches the documented defaults', () => {
            expect(DEFAULT_SETTINGS).toEqual({
                origin: 'https://shikimori.io',
                titleLang: 'ru',
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

        it('clearSession wipes the session area but not local', async () => {
            await setSession('lastTab', 'search');
            // A pending selection is personal data too and must not survive logout.
            await setSession('pendingSearch', { query: 'берсерк' });
            await setLocal('settings', DEFAULT_SETTINGS);

            await clearSession();

            await expect(getSession('lastTab')).resolves.toBeUndefined();
            await expect(getSession('pendingSearch')).resolves.toBeUndefined();
            await expect(getLocal('settings')).resolves.toEqual(DEFAULT_SETTINGS);
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
