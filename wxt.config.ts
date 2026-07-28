import { defineConfig } from 'wxt';

// Public key (base64 DER SPKI) pinning the production extension ID to
// ilcnkoocagmcjikbelobkiflaplolbak so the OAuth redirect URI stays stable
// regardless of install path. Private key lives in .keys/ (gitignored).
// Applied only to `build`/`zip`: the dev extension keeps its own ID and can
// be installed alongside the production one.
const PROD_MANIFEST_KEY =
    'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAktDqts9CaYZZePn4wGOXO5oJJFuQ35gEibE8PZa+qY1xa9bIqlHMw3GS+l0OET/nReGNXUGlwl4VKB+48Vxc2TgXo/Z5UhknFO0+u/9OKXO1MxVYxiWSG61qPjAysK2sigOdUL6WBuvexYI8iB1ly/47g2PozMCxBTcL/9NroeyMiNuCuVBEohkNC0+Nw2ALG8aJhc6Pw6zms3y4kjMVnayWxyMcQPKKJHwh4Cw0SrbU3AcxjwS+B2sDIWt53F20o3iiLZEPcv/VBDKnRRceSKetNXfhsUlZvjhLLVDaKxebim+8aQeHedyLSUwIo36RM++RX/jy5a2pNEt5PYPeEQIDAQAB';

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
        name: 'ShikiFav',
        // Explicit description: without it WXT falls back to the English
        // `description` from package.json. Chrome Web Store caps it at 132 chars.
        description:
            'Быстрый доступ к спискам Shikimori: поиск аниме, манги и ранобэ, статусы, оценки и «+1 эпизод» без открытия сайта.',
        ...(env.command === 'build' ? { key: PROD_MANIFEST_KEY } : {}),
        // declarativeNetRequestWithHostAccess, not declarativeNetRequest: the
        // UA rule (modifyHeaders) requires host permissions anyway, and this
        // variant grants nothing beyond hosts we already have (CLAUDE.md rule 7).
        // contextMenus arrives exactly in phase 5 (US-8, CLAUDE.md rule 7);
        // tabs.create({ url }) needs no "tabs" permission.
        permissions: ['identity', 'storage', 'declarativeNetRequestWithHostAccess', 'contextMenus'],
        host_permissions: ['https://shikimori.one/*', 'https://shikimori.io/*'],
    }),
});
