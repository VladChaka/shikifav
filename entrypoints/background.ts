import { ensureToken, getAuthState, login, logout } from '@/src/lib/api/auth';
import { apiRequest, oauthRequest, setTokenProvider } from '@/src/lib/api/http';
import { onMessage } from '@/src/lib/messaging';

export default defineBackground(() => {
    // Module state dies with the service worker; defineBackground runs on every
    // SW start, so the provider is always registered before any API request.
    setTokenProvider(ensureToken);

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
    });

    // TEMP UA-check (task 6): remove after verification
    // Dev-only probe for the docs/03 checklist item "does the custom
    // User-Agent survive fetch() from the MV3 service worker": fires one
    // request so its headers can be inspected in the SW DevTools Network tab.
    if (import.meta.env.DEV) {
        runUaCheck().catch(() => console.debug('UA-check failed'));
    }
});

// TEMP UA-check (task 6): remove after verification
// apiRequest never reaches the network without a stored token (ensureToken
// throws before fetch), so when anonymous we probe /oauth/token with an
// invalid grant instead: same http.ts choke point, guaranteed real request,
// harmless 4xx from the server, no credentials in the body.
async function runUaCheck(): Promise<void> {
    const { status } = await getAuthState();
    const result =
        status === 'authorized'
            ? await apiRequest<unknown>('/api/users/whoami')
            : await oauthRequest<unknown>('/oauth/token', { grant_type: 'ua_check' });
    console.debug('UA-check request fired:', result.ok ? 'ok' : result.error.kind);
}
