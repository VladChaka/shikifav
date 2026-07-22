import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
    modules: ['@wxt-dev/module-vue'],
    manifest: {
        name: 'ShikiFav',
        // declarativeNetRequestWithHostAccess, not declarativeNetRequest: the
        // UA rule (modifyHeaders) requires host permissions anyway, and this
        // variant grants nothing beyond hosts we already have (CLAUDE.md rule 7).
        permissions: ['identity', 'storage', 'declarativeNetRequestWithHostAccess'],
        host_permissions: ['https://shikimori.one/*', 'https://shikimori.io/*'],
    },
});
