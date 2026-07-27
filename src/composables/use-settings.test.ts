import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { DEFAULT_SETTINGS, setSettings } from '../lib/storage';
import type { UseSettings } from './use-settings';

// The composable keeps shared module-level state and registers its storage
// listener on first use, so every test builds a fresh module graph — after
// fakeBrowser.reset(), which drops the listeners of the previous one. The fake
// browser itself survives vi.resetModules(), so storage written here is the
// same storage the fresh graph reads.
async function setup(): Promise<UseSettings> {
    vi.resetModules();
    const composable = await import('./use-settings');
    return composable.useSettings();
}

describe('use-settings', () => {
    beforeEach(() => {
        fakeBrowser.reset();
    });

    it('starts at the defaults before storage resolves', async () => {
        const { settings } = await setup();
        expect(settings.value).toEqual(DEFAULT_SETTINGS);
    });

    it('loads the stored settings on first use', async () => {
        await setSettings({ titleLang: 'romaji' });

        const { settings } = await setup();

        await vi.waitFor(() => {
            expect(settings.value.titleLang).toBe('romaji');
        });
        expect(settings.value.origin).toBe(DEFAULT_SETTINGS.origin);
    });

    // The options page writes settings from another context (or another open
    // page): an already mounted search tab must follow without a reload.
    // The non-default origin is seeded first so the initial load is observable
    // — waiting for a value that equals the default would prove nothing.
    it('picks up a later change in storage', async () => {
        await setSettings({ origin: 'https://shikimori.one' });
        const { settings } = await setup();
        await vi.waitFor(() => {
            expect(settings.value.origin).toBe('https://shikimori.one');
        });

        await setSettings({ titleLang: 'romaji' });

        await vi.waitFor(() => {
            expect(settings.value.titleLang).toBe('romaji');
        });
    });

    it('keeps the defaults for keys missing from a partially written object', async () => {
        const { settings } = await setup();

        // A raw write of an incomplete object — what an older build could leave.
        await fakeBrowser.storage.local.set({ settings: { titleLang: 'romaji' } });

        await vi.waitFor(() => {
            expect(settings.value.titleLang).toBe('romaji');
        });
        expect(settings.value.origin).toBe(DEFAULT_SETTINGS.origin);
    });

    // A token refresh rewrites `auth` on every popup open: re-reading settings
    // on such a change would be pure waste.
    it('does not re-read storage when another local key changes', async () => {
        await setSettings({ titleLang: 'romaji' });
        const { settings } = await setup();
        await vi.waitFor(() => {
            expect(settings.value.titleLang).toBe('romaji');
        });
        const reads = vi.spyOn(fakeBrowser.storage.local, 'get');

        // set() awaits the listeners, so a reload would have hit the spy.
        await fakeBrowser.storage.local.set({
            auth: {
                accessToken: 'a',
                refreshToken: 'r',
                expiresAt: 0,
                user: { id: 1, nickname: 'n', avatarUrl: '' },
            },
        });

        expect(reads).not.toHaveBeenCalled();
        expect(settings.value.titleLang).toBe('romaji');
        reads.mockRestore();
    });

    // Ф6-23: the load is fire-and-forget, so a rejected read would surface as an
    // unhandled rejection while the page initialises (same rule as theme.ts).
    it('keeps the defaults when the storage read fails', async () => {
        const read = vi
            .spyOn(fakeBrowser.storage.local, 'get')
            .mockRejectedValue(new Error('storage unavailable'));

        const { settings } = await setup();

        await vi.waitFor(() => expect(read).toHaveBeenCalled());
        expect(settings.value).toEqual(DEFAULT_SETTINGS);
        read.mockRestore();
    });

    it('shares one state across callers', async () => {
        const first = await setup();
        const composable = await import('./use-settings');
        const second = composable.useSettings();
        expect(second.settings).toBe(first.settings);
    });
});
