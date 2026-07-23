import { ensureToken, getAuthState, login, logout } from '@/src/lib/api/auth';
import { listAnimeRates, searchTitles } from '@/src/lib/api/graphql';
import { setTokenProvider } from '@/src/lib/api/http';
import { createRate, deleteRate, incrementRate, updateRate } from '@/src/lib/api/rates';
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
        'auth.login': async () => ({ user: await login() }),
        'auth.logout': async () => {
            await logout();
            return {};
        },
        'search.titles': async ({ query, type, page }) => ({
            items: await searchTitles(query, type, page),
        }),
        'rates.list': async ({ type, status, page }) => {
            // hasMore is computed in the read layer from the raw page length, so
            // a dropped userRate==null row cannot cut paging short (docs/06).
            const { items, hasMore } = await listAnimeRates(type, status, page);
            return { items, hasMore };
        },
        'rates.create': async ({ targetId, targetType, status }) => ({
            rate: await createRate(targetId, targetType, status),
        }),
        'rates.update': async ({ rateId, patch }) => ({
            rate: await updateRate(rateId, patch),
        }),
        'rates.delete': async ({ rateId }) => {
            await deleteRate(rateId);
            return {};
        },
        'rates.increment': async ({ rateId }) => ({
            rate: await incrementRate(rateId),
        }),
    });
});
