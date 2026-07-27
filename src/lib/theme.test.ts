import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { setSettings } from './storage';
import type { ThemeRoot } from './theme';

// Stand-in for <html>: the unit project has no DOM (vitest.config.ts), and
// theme.ts only ever touches these two methods.
interface FakeRoot extends ThemeRoot {
    attrs: Map<string, string>;
}

function createRoot(): FakeRoot {
    const attrs = new Map<string, string>();
    return {
        attrs,
        setAttribute(name: string, value: string): void {
            attrs.set(name, value);
        },
        removeAttribute(name: string): void {
            attrs.delete(name);
        },
    };
}

// theme.ts keeps module-level state (the "subscribed" guard) and registers its
// storage listener on first initTheme(), so every test builds a fresh module
// graph — after fakeBrowser.reset(), which drops the listeners of the previous
// one. The fake browser survives vi.resetModules(), so storage written here is
// the storage the fresh graph reads.
async function importTheme(): Promise<typeof import('./theme')> {
    vi.resetModules();
    return import('./theme');
}

describe('theme', () => {
    beforeEach(() => {
        fakeBrowser.reset();
    });

    describe('applyTheme', () => {
        it('sets data-theme="dark" for the explicit dark theme', async () => {
            const { applyTheme } = await importTheme();
            const root = createRoot();

            applyTheme('dark', root);

            expect(root.attrs.get('data-theme')).toBe('dark');
        });

        // The case the stylesheet cares about most: an explicit light choice has
        // to be marked even on a dark system, hence an attribute (not "nothing").
        it('sets data-theme="light" for the explicit light theme', async () => {
            const { applyTheme } = await importTheme();
            const root = createRoot();

            applyTheme('light', root);

            expect(root.attrs.get('data-theme')).toBe('light');
        });

        it('removes the attribute for the system theme', async () => {
            const { applyTheme } = await importTheme();
            const root = createRoot();

            applyTheme('dark', root);
            applyTheme('system', root);

            expect(root.attrs.has('data-theme')).toBe(false);
        });
    });

    describe('initTheme', () => {
        it('applies the stored theme', async () => {
            await setSettings({ theme: 'dark' });
            const { initTheme } = await importTheme();
            const root = createRoot();

            await initTheme(root);

            expect(root.attrs.get('data-theme')).toBe('dark');
        });

        it('leaves no attribute on empty storage (default is system)', async () => {
            const { initTheme } = await importTheme();
            const root = createRoot();

            await initTheme(root);

            expect(root.attrs.has('data-theme')).toBe(false);
        });

        // A build that predates the setting leaves an object without `theme`;
        // getSettings() fills it per key, so the page must render as system.
        it('falls back to system for a partially written settings object', async () => {
            await fakeBrowser.storage.local.set({ settings: { titleLang: 'romaji' } });
            const { initTheme } = await importTheme();
            const root = createRoot();

            await initTheme(root);

            expect(root.attrs.has('data-theme')).toBe(false);
        });

        it('resolves and keeps the system theme when the storage read fails', async () => {
            const read = vi
                .spyOn(fakeBrowser.storage.local, 'get')
                .mockRejectedValue(new Error('storage unavailable'));
            const { initTheme } = await importTheme();
            const root = createRoot();

            await expect(initTheme(root)).resolves.toBeUndefined();

            expect(root.attrs.has('data-theme')).toBe(false);
            read.mockRestore();
        });
    });

    describe('reacting to a settings change', () => {
        // The options page writes from another context: an already open popup or
        // search tab has to repaint without a reload.
        it('applies a theme chosen after init', async () => {
            const { initTheme } = await importTheme();
            const root = createRoot();
            await initTheme(root);

            await setSettings({ theme: 'light' });

            await vi.waitFor(() => {
                expect(root.attrs.get('data-theme')).toBe('light');
            });
        });

        it('drops the attribute when the theme goes back to system', async () => {
            await setSettings({ theme: 'dark' });
            const { initTheme } = await importTheme();
            const root = createRoot();
            await initTheme(root);
            expect(root.attrs.get('data-theme')).toBe('dark');

            await setSettings({ theme: 'system' });

            await vi.waitFor(() => {
                expect(root.attrs.has('data-theme')).toBe(false);
            });
        });

        // A change of another setting still repaints (harmless), but a token
        // refresh rewrites `auth` on every popup open — that must not re-read.
        it('does not re-read storage when another local key changes', async () => {
            await setSettings({ theme: 'dark' });
            const { initTheme } = await importTheme();
            const root = createRoot();
            await initTheme(root);
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
            expect(root.attrs.get('data-theme')).toBe('dark');
            reads.mockRestore();
        });

        it('subscribes once even if initTheme runs twice', async () => {
            const listeners = vi.spyOn(fakeBrowser.storage.local.onChanged, 'addListener');
            const { initTheme } = await importTheme();
            const root = createRoot();

            await initTheme(root);
            await initTheme(root);

            expect(listeners).toHaveBeenCalledTimes(1);
            listeners.mockRestore();
        });
    });
});
