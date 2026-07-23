import { ensureToken, getAuthState, login, logout } from '@/src/lib/api/auth';
import { setTokenProvider } from '@/src/lib/api/http';
import type { ApiError } from '@/src/lib/api/types';
import { registerUserAgentRule } from '@/src/lib/api/user-agent-rule';
import { onMessage } from '@/src/lib/messaging';

// Phase 2 search/write handlers land in the next task; stubs keep the
// MessageHandlers map exhaustive without pretending to work.
function notImplemented(): never {
    throw { kind: 'internal', message: 'not implemented' } satisfies ApiError;
}

export default defineBackground(() => {
    // Module state dies with the service worker; defineBackground runs on every
    // SW start, so the provider is always registered before any API request.
    setTokenProvider(ensureToken);

    // Chrome drops the fetch()-level User-Agent in the MV3 SW (docs/03), so a
    // DNR rule enforces it; errors are swallowed inside (console.debug only).
    void registerUserAgentRule();

    // MessageHandlers is a mapped type over every MessageMap key, so this object
    // must stay exhaustive: adding a message type without a handler fails compile.
    onMessage({
        ping: async () => ({ pong: true }),
        'auth.getState': () => getAuthState(),
        'auth.login': async () => ({ user: await login() }),
        'auth.logout': async () => {
            await logout();
            return {};
        },
        'search.titles': async () => notImplemented(),
        'rates.create': async () => notImplemented(),
        'rates.update': async () => notImplemented(),
        'rates.delete': async () => notImplemented(),
    });
});
