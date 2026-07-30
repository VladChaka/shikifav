import { afterEach, describe, expect, it, vi } from 'vitest';
import { NO_MANIFEST_KEY, manifestKeyField } from './manifest-key';

// Build-time rule with a runtime blast radius: the field decided here fixes the
// extension ID, and the ID is half of the OAuth redirect URI. Wrong key, or no
// key where one was meant, and login fails for every install at once — which is
// exactly what cannot be caught by a test of the extension itself.
describe('manifestKeyField', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('puts the configured key into the manifest', () => {
        expect(manifestKeyField('MIIBIjANBg')).toEqual({ key: 'MIIBIjANBg' });
    });

    it('trims the value — a .env line is hand-edited text', () => {
        expect(manifestKeyField('  MIIBIjANBg\n')).toEqual({ key: 'MIIBIjANBg' });
    });

    it.each([[undefined], [''], ['   ']])(
        'refuses to build with %p instead of a key',
        (raw: string | undefined) => {
            // Not a silent fallback: a build without the key still works, still
            // installs, and only reveals itself at the first login attempt.
            expect(() => manifestKeyField(raw)).toThrow(/WXT_MANIFEST_KEY is not configured/);
        },
    );

    it(`omits the field entirely on "${NO_MANIFEST_KEY}"`, () => {
        // The first draft upload to the store: the key comes back from the
        // console, so the package sent there must not carry ours.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        // Not `{ key: undefined }` — that would still write the field out.
        expect(manifestKeyField(NO_MANIFEST_KEY)).not.toHaveProperty('key');
        // Deliberate, but never silent: the resulting build cannot log in.
        expect(warn).toHaveBeenCalledOnce();
    });
});
