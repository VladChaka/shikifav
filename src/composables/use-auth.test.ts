import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import type { MessageHandlers } from '../lib/messaging';
import type { ApiError, User } from '../lib/api/types';
import type { UseAuth } from './use-auth';

const testUser: User = { id: 1, nickname: 'tester', avatarUrl: 'https://cdn.test/a.png' };

// The composable keeps shared module-level state, so every test builds a fresh
// module graph; handlers are registered via the SAME graph's messaging module,
// otherwise the listener could land on a different browser instance.
async function setup(overrides: Partial<MessageHandlers> = {}): Promise<UseAuth> {
    vi.resetModules();
    const messaging = await import('../lib/messaging');
    messaging.onMessage({
        ping: async () => ({ pong: true }),
        'auth.getState': async () => ({ status: 'anonymous' }),
        'auth.login': async () => ({ user: testUser }),
        'auth.logout': async () => ({}),
        'search.titles': async () => ({ items: [] }),
        'rates.list': async () => ({ items: [], hasMore: false }),
        'calendar.list': async () => ({ items: [] }),
        'titles.related': async () => ({ items: [] }),
        'posters.fetch': async () => ({ posters: {} }),
        'rates.create': async () => ({ rate: { id: '1', status: 'planned' } }),
        'rates.update': async () => ({
            rate: { id: '1', status: 'watching', score: 0, episodes: 0, chapters: 0, volumes: 0 },
        }),
        'rates.delete': async () => ({}),
        'rates.increment': async () => ({
            rate: { id: '1', status: 'watching', score: 0, episodes: 0, chapters: 0, volumes: 0 },
        }),
        'settings.setOrigin': async () => ({}),
        'analytics.track': async () => ({}),
        ...overrides,
    });
    const composable = await import('./use-auth');
    return composable.useAuth();
}

describe('use-auth', () => {
    beforeEach(() => {
        fakeBrowser.reset();
    });

    it('starts in loading and auto-refreshes to the background state', async () => {
        const auth = await setup({
            'auth.getState': async () => ({ status: 'authorized', user: testUser }),
        });
        await vi.waitFor(() => {
            expect(auth.status.value).toBe('authorized');
        });
        expect(auth.user.value).toEqual(testUser);
    });

    it('login success sets authorized state with the user', async () => {
        const auth = await setup();
        await auth.login();
        expect(auth.status.value).toBe('authorized');
        expect(auth.user.value).toEqual(testUser);
        expect(auth.error.value).toBeUndefined();
        expect(auth.pending.value).toBe(false);
    });

    it('login failure keeps the state and exposes the ApiError kind', async () => {
        const auth = await setup({
            'auth.login': async () => {
                throw { kind: 'network' } satisfies ApiError;
            },
        });
        await auth.refreshState();
        await auth.login();
        expect(auth.status.value).toBe('anonymous');
        expect(auth.error.value).toEqual({ kind: 'network' });
        expect(auth.pending.value).toBe(false);
    });

    it('logout returns to anonymous and drops the user', async () => {
        const auth = await setup({
            'auth.getState': async () => ({ status: 'authorized', user: testUser }),
        });
        await auth.refreshState();
        expect(auth.status.value).toBe('authorized');

        await auth.logout();
        expect(auth.status.value).toBe('anonymous');
        expect(auth.user.value).toBeUndefined();
    });

    it('falls back to anonymous with an error when getState fails', async () => {
        const auth = await setup({
            'auth.getState': async () => {
                throw { kind: 'internal', message: 'boom' } satisfies ApiError;
            },
        });
        await auth.refreshState();
        expect(auth.status.value).toBe('anonymous');
        expect(auth.error.value).toEqual({ kind: 'internal', message: 'boom' });
    });
});
