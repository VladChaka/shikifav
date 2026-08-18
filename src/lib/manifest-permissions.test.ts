import { describe, expect, it } from 'vitest';
import type { ConfigEnv, UserManifest } from 'wxt';
import config from '@/wxt.config';
import { GA4_ENDPOINT, ORIGINS } from './config';

// Ф11-13. The DoD of phase 11 promises two things nobody could break loudly:
// «host_permissions не изменились» and — owner's decision 2 — that
// `notifications` stays OPTIONAL. Both live in wxt.config.ts, which no test used
// to read at all: moving `notifications` into the mandatory list, or adding a
// fourth host, left the whole suite green (мутационная проверка Ф11-13). The
// cost of that mistake is paid after publication, by every installed profile:
// a new permission WARNING disables the extension until the user accepts it
// (docs/06, решение 2), and a new host has to be justified to the store again
// (CLAUDE.md rule 7, docs/07).
//
// This file pins the declared surface as a whole — an exact list, not a
// «contains»: an addition is exactly the change that has to be noticed, and a
// deliberate one costs one edited line here.

const SERVE: ConfigEnv = {
    command: 'serve',
    mode: 'development',
    browser: 'chrome',
    manifestVersion: 3,
};

// The shipped manifest, i.e. what the store and the installed base actually see.
// `build` also injects the extension key, so it is only asked for on a checkout
// that has one — the same rule analytics.test.ts follows for the GA4 keys.
const BUILD: ConfigEnv = { ...SERVE, command: 'build', mode: 'production' };
const hasManifestKey = (import.meta.env.WXT_MANIFEST_KEY ?? '') !== '';
const whenKeyed = hasManifestKey ? it : it.skip;

async function manifestFor(env: ConfigEnv): Promise<UserManifest> {
    const declared = config.manifest;
    if (declared === undefined) {
        throw new Error('wxt.config.ts declares no manifest');
    }
    return typeof declared === 'function' ? await declared(env) : declared;
}

describe('manifest permissions', () => {
    // Every entry is a phase that had to justify it: identity/storage (phase 1),
    // declarativeNetRequestWithHostAccess (User-Agent rule, CLAUDE.md rule 3),
    // contextMenus (phase 5), alarms (phase 11). Nothing else may appear here
    // without the same conversation.
    it('declares exactly the permissions the phases asked for', async () => {
        const manifest = await manifestFor(SERVE);

        expect(manifest.permissions).toEqual([
            'identity',
            'storage',
            'declarativeNetRequestWithHostAccess',
            'contextMenus',
            'alarms',
        ]);
    });

    // The background watch cannot exist without it, and it is the ONLY mandatory
    // permission phase 11 added: `alarms` carries no permission warning, so an
    // update with it does not disable the extension for anyone (docs/06, решение 2).
    it('carries alarms, the one mandatory permission of phase 11', async () => {
        const manifest = await manifestFor(SERVE);

        expect(manifest.permissions).toContain('alarms');
    });

    // Owner's decision 2, the line wxt.config.ts states as «it must never move
    // into this list»: «Display notifications» IS a warning, and a warning added
    // by an update disables the extension for every installed profile until the
    // user accepts it. Optional, it costs one button on the settings page.
    it('keeps notifications optional and out of the mandatory list', async () => {
        const manifest = await manifestFor(SERVE);

        expect(manifest.optional_permissions).toEqual(['notifications']);
        expect(manifest.permissions).not.toContain('notifications');
    });

    // «host_permissions не изменились» of the DoD, as an exact list: the two
    // Shikimori domains (the origin is a setting, so both ship) and the single
    // non-Shikimori host of phase 10.
    it('asks for the two Shikimori origins and the analytics host, and nothing else', async () => {
        const manifest = await manifestFor(SERVE);

        expect(manifest.host_permissions).toEqual([
            'https://shikimori.one/*',
            'https://shikimori.io/*',
            'https://www.google-analytics.com/*',
        ]);
    });

    // The same list read from the code that uses it: a domain added to ORIGINS
    // (CLAUDE.md rule 4) without a host permission would fail at runtime, and a
    // host left here after a domain was dropped is a permission nobody needs.
    it('covers every origin the code can talk to, and only those', async () => {
        const manifest = await manifestFor(SERVE);
        const hosts = manifest.host_permissions ?? [];

        expect([...hosts].sort()).toEqual(
            [...ORIGINS.map((origin) => `${origin}/*`), `${new URL(GA4_ENDPOINT).origin}/*`].sort(),
        );
        expect(hosts.every((host) => host.startsWith('https://'))).toBe(true);
    });

    // The dev build and the shipped build differ by the extension key alone
    // (wxt.config.ts): whatever is asserted above has to hold for the artefact
    // that actually reaches the store.
    whenKeyed('declares the same surface in the production build', async () => {
        const dev = await manifestFor(SERVE);
        const shipped = await manifestFor(BUILD);

        expect(shipped.permissions).toEqual(dev.permissions);
        expect(shipped.optional_permissions).toEqual(dev.optional_permissions);
        expect(shipped.host_permissions).toEqual(dev.host_permissions);
    });
});
