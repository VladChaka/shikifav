import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';
import type { Plugin } from 'vitest/config';
import { WxtVitest } from 'wxt/testing';

// WxtVitest() wires up WXT globals, path aliases and the extension-API mock,
// but does not apply vite plugins registered by WXT modules — so .vue SFCs
// imported from component tests would fail to transform. Instead of declaring
// a duplicate @vitejs/plugin-vue devDependency, borrow the exact instance that
// @wxt-dev/module-vue (already a devDependency) uses for real builds.
async function moduleVuePlugin(): Promise<Plugin> {
    const rootRequire = createRequire(import.meta.url);
    const moduleVueRequire = createRequire(rootRequire.resolve('@wxt-dev/module-vue'));
    const pluginEntry = moduleVueRequire.resolve('@vitejs/plugin-vue');
    const { default: vue } = (await import(pathToFileURL(pluginEntry).href)) as {
        default: () => Plugin;
    };
    return vue();
}

export default defineConfig({
    plugins: [WxtVitest(), moduleVuePlugin()],
    test: {
        projects: [
            {
                extends: true,
                test: {
                    name: 'unit',
                    include: ['src/**/*.test.ts'],
                    exclude: [...configDefaults.exclude, 'src/components/**'],
                },
            },
            {
                // Component tests mount SFCs, which requires client-mode
                // transforms — see vitest-environment-node-client.ts.
                extends: true,
                test: {
                    name: 'components',
                    include: ['src/components/**/*.test.ts'],
                    environment: './vitest-environment-node-client.ts',
                },
            },
        ],
    },
});
