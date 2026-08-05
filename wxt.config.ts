import { defineConfig } from 'wxt';
import { manifestKeyField } from './src/lib/manifest-key';

declare global {
    // Build-time only, and read exactly once — here. WXT loads .env before the
    // manifest function runs, which is why the manifest is a function and not
    // an object (wxt.dev/guide/essentials/config/environment-variables).
    interface ImportMetaEnv {
        // Public key (base64 DER SPKI) pinning the production extension ID, so
        // the OAuth redirect URI stays stable regardless of install path. Not a
        // secret — it ships inside every build; the private half lives in
        // .keys/ (gitignored). It used to be a literal in this file and moved
        // to .env because the store hands out its own key on the first draft
        // upload (docs/06, phase 9): swapping it must cost one edited line, not
        // a code change made while sitting in the developer console.
        readonly WXT_MANIFEST_KEY?: string;
    }
}

// See https://wxt.dev/api/config.html
export default defineConfig({
    modules: ['@wxt-dev/module-vue'],
    // Never inline assets as data URIs. Vite inlines anything under 4 KB by
    // default, which put the poster placeholder inside the popup bundle and
    // cost 9 KB gzip of the JS budget — for an image the browser would
    // otherwise fetch once and cache. Whether an asset crosses that threshold
    // is also a matter of a few bytes, so the behaviour is pinned rather than
    // left to chance.
    vite: () => ({ build: { assetsInlineLimit: 0 } }),
    manifest: (env) => ({
        name: 'ShikiFAV',
        // Explicit description: without it WXT falls back to the English
        // `description` from package.json. Chrome Web Store caps it at 132
        // chars; this one is 116. Kept identical to the store listing's short
        // description (docs/07) — the two are shown side by side, one in
        // chrome://extensions and one in the store.
        description:
            'Списки Shikimori в панели браузера: поиск аниме, манги и ранобэ, статусы, оценки, «+1 эпизод» и календарь онгоингов.',
        // Only `build`/`zip` get a key: the dev extension keeps its own
        // path-derived ID and can be installed alongside the production one.
        ...(env.command === 'build' ? manifestKeyField(import.meta.env.WXT_MANIFEST_KEY) : {}),
        // declarativeNetRequestWithHostAccess, not declarativeNetRequest: the
        // UA rule (modifyHeaders) requires host permissions anyway, and this
        // variant grants nothing beyond hosts we already have (CLAUDE.md rule 7).
        // contextMenus arrives exactly in phase 5 (US-8, CLAUDE.md rule 7);
        // tabs.create({ url }) needs no "tabs" permission.
        permissions: ['identity', 'storage', 'declarativeNetRequestWithHostAccess', 'contextMenus'],
        // google-analytics.com arrives in фаза 10 and is the only host here that
        // is not Shikimori. It carries anonymous usage events and nothing else:
        // the token and the app User-Agent belong to http.ts, which never talks
        // to this host (src/lib/api/analytics.ts). Needs its own justification
        // in the store listing — docs/07.
        host_permissions: [
            'https://shikimori.one/*',
            'https://shikimori.io/*',
            'https://www.google-analytics.com/*',
        ],
    }),
});
