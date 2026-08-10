import { describe, expect, it } from 'vitest';
import { httpsHref, mailtoHref } from './external-url';

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
        // The counterpart of mailtoHref below: mail is admitted by a second
        // function on purpose, never by a second scheme inside this one. This
        // guard also feeds the <img src> of posters and avatars, where a
        // mailto: address means nothing — so should the two ever be merged into
        // one "list of allowed schemes", it fails here first.
        ['mailto:support@chakalabs.com'],
    ])('refuses %s', (url) => {
        expect(httpsHref(url)).toBeNull();
    });
});

// The mail half of the same gate (Ф8-2): the report line of «Поддержать» is the
// only caller. What may pass is one bare address and nothing else, so these pin
// the shape rather than the current value of that address.
describe('mailtoHref', () => {
    it('passes one bare address through unchanged', () => {
        expect(mailtoHref('mailto:support@chakalabs.com')).toBe('mailto:support@chakalabs.com');
        // Dots and a `+` tag are ordinary in a local part — the guard must not
        // be so tight that a real address has to be rewritten to survive it.
        expect(mailtoHref('mailto:first.last+shikifav@mail.chakalabs.com')).toBe(
            'mailto:first.last+shikifav@mail.chakalabs.com',
        );
    });

    // Not cosmetics. A mailto: url can carry the letter itself in its query:
    // `?subject=`/`?body=` compose a message on the user's behalf, and `?bcc=`
    // sends a copy of whatever they then hit send on to a third party — from
    // their own mail client, under their own name. The address is an invitation
    // to write; everything after `?` or `&` is somebody else writing for them.
    it.each([
        ['mailto:support@chakalabs.com?subject=Verify%20your%20account'],
        ['mailto:support@chakalabs.com?body=my%20token%20is'],
        ['mailto:support@chakalabs.com?bcc=hidden@evil.test'],
        ['mailto:support@chakalabs.com&cc=hidden@evil.test'],
    ])('refuses the prefilled letter of %s', (url) => {
        expect(mailtoHref(url)).toBeNull();
    });

    // The same refusals written in percent-encoding, which is where a guard
    // over literal characters alone falls apart: `%2C` is the comma of a
    // recipient list, `%0D%0A` the line break a `Bcc:` header hides behind,
    // `%3F`/`%26` the query that composes the letter. Decoding happens in the
    // mail client, long after this guard has said yes, so every one of these
    // passes the ban on `,`, `\n`, `?` and `&` while meaning exactly what the
    // ban refuses. Hence `%` is out as a character, not case by case: no
    // address this project links to has any use for one.
    it.each([
        // Two recipients once decoded: `a@evil.test` and `b@chakalabs.com` —
        // the letter reaches the third party first.
        ['mailto:a%40evil.test%2Cb@chakalabs.com'],
        // A CRLF and a `Bcc:` header behind it.
        ['mailto:sup%0D%0ABcc%3A%20x%40evil.test@chakalabs.com'],
        // The prefilled letter of the block above, with `?` and `&` encoded.
        ['mailto:support%3Fsubject%3DVerify%20your%20account@chakalabs.com'],
        ['mailto:support%26cc%3Dhidden%40evil.test@chakalabs.com'],
    ])('refuses the percent-encoded %s', (url) => {
        expect(mailtoHref(url)).toBeNull();
    });

    it.each([
        // One address means one recipient; both list separators are refused.
        ['mailto:support@chakalabs.com,hidden@evil.test'],
        ['mailto:support@chakalabs.com;hidden@evil.test'],
        // Not an address at all: no @, no dot in the domain, a one-letter TLD.
        ['mailto:support.chakalabs.com'],
        ['mailto:support@localhost'],
        ['mailto:support@chakalabs.c'],
        // Whitespace is how a header would be smuggled in behind a break.
        ['mailto:support @chakalabs.com'],
        ['mailto:support@chakalabs.com\nBcc: hidden@evil.test'],
        // Case matters, same rule as httpsHref: a value that has to be
        // normalised before it can be judged is not worth trusting.
        ['MAILTO:support@chakalabs.com'],
        [''],
        [null],
        [undefined],
        // The two schemes this function must never be mistaken for.
        ['javascript:alert(1)'],
        ['https://chakalabs.com'],
    ])('refuses %s', (url) => {
        expect(mailtoHref(url)).toBeNull();
    });
});
