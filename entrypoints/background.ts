import { ensureToken, getAuthState, login, logout, validateSession } from '@/src/lib/api/auth';
import { setTokenProvider } from '@/src/lib/api/http';
import { registerUserAgentRule } from '@/src/lib/api/user-agent-rule';
import { onMessage } from '@/src/lib/messaging';

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
        'auth.validate': () => validateSession(),
        'auth.login': async () => ({ user: await login() }),
        'auth.logout': async () => {
            await logout();
            return {};
        },
    });
});
