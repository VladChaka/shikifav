import { describe, expect, it } from 'vitest';
import { httpsHref } from './external-url';

// The single gate between a value this code did not construct and a live href:
// a title url from the API (Ф6-26) and a hand-edited donation link (Ф8-2) go
// through it. Both callers have tests of their own; these pin the rule itself,
// so a "let's also allow http" would fail here and not only in a component.
describe('httpsHref', () => {
    it('passes an https link through unchanged', () => {
        expect(httpsHref('https://shikimori.io/animes/1')).toBe('https://shikimori.io/animes/1');
        expect(httpsHref('https://boosty.to/x?a=1#b')).toBe('https://boosty.to/x?a=1#b');
    });

    it.each([
        // Downgrade — the extension never links out over plain http.
        ['http://shikimori.io/animes/1'],
        // The two schemes that would run code in the tab that opens them.
        ['javascript:alert(1)'],
        ['data:text/html,<script>alert(1)</script>'],
        // No scheme at all: relative and protocol-relative both resolve against
        // the extension page, which is not where an external link points.
        ['/animes/1'],
        ['//evil.test/x'],
        [''],
        // Case matters: the check is a plain prefix test, and a value that needs
        // normalising first is not a value worth trusting.
        ['HTTPS://shikimori.io/animes/1'],
        // A record from an older session cache, and a field the API left empty.
        [null],
        [undefined],
    ])('refuses %s', (url) => {
        expect(httpsHref(url)).toBeNull();
    });
});
