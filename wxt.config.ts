import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
    modules: ['@wxt-dev/module-vue'],
    manifest: {
        name: 'ShikiFav',
        permissions: ['identity', 'storage'],
        host_permissions: ['https://shikimori.one/*', 'https://shikimori.io/*'],
    },
});
