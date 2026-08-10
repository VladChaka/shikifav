import { describe, expect, it } from 'vitest';
import { DONATION_METHODS, SUPPORT_ACTIONS, payHref, supportHref } from './donations';
import { httpsHref } from './external-url';

// Ф8-1: the content of the «Поддержать» section. Both lists are hand-edited, so
// what is pinned here are the invariants the section renders on — never the
// entries themselves: the owner adds a payment link by editing one array, and
// that must not break a test.

describe('donations', () => {
    describe('DONATION_METHODS', () => {
        // Both lists are rendered with the id as the v-for key, so a duplicate
        // would silently drop a row.
        it('keeps the ids unique', () => {
            const ids = DONATION_METHODS.map((method) => method.id);
            expect(new Set(ids).size).toBe(ids.length);
        });

        it('gives every method an id, a label, a hint and an https link', () => {
            for (const method of DONATION_METHODS) {
                expect(method.id).not.toBe('');
                expect(method.label).not.toBe('');
                expect(method.hint).not.toBe('');
                // A donation link that does not survive the guard costs the
                // whole entry: the section drops a method it cannot link to, so
                // a typo here would silently show nothing at all (Ф8-6).
                expect(payHref(method)).toBe(method.url);
            }
        });

        // «Касса только по https» is payHref()'s job now, so this is not that
        // rule under test — it is the shipped config read through the strictest
        // guard there is, independently of which one the section happens to
        // call. Were payHref ever widened (a second scheme, a normalising
        // pass), a non-https address in this array would still fail here.
        it('ships every payment link as https, whatever the guard tolerates', () => {
            for (const method of DONATION_METHODS) {
                expect(httpsHref(method.url)).toBe(method.url);
            }
        });
    });

    describe('SUPPORT_ACTIONS', () => {
        // The free ways to help cost nothing to offer, so they are always there.
        // Their wording is picked from i18n by these ids (options.help*), so a
        // rename here silently empties a row.
        it('offers the four free ways to help', () => {
            expect(SUPPORT_ACTIONS.map((action) => action.id)).toEqual([
                'review',
                'share',
                'bug',
                'telegram',
            ]);
        });

        // An action without a link is a valid state (the Telegram channel does
        // not exist yet), rendered as plain text or hidden. One WITH a link
        // must reach the section as that link: an address that does not survive
        // the guard is not a typo the page reports, it is a row that silently
        // stops being clickable.
        it('lets every url it does declare survive supportHref', () => {
            for (const action of SUPPORT_ACTIONS) {
                if (action.url === undefined) {
                    expect(supportHref(action)).toBeNull();
                } else {
                    expect(supportHref(action)).toBe(action.url);
                }
            }
        });

        // The one place this file does pin the entries themselves, and on
        // purpose: `needsUrl` is the whole mechanism by which an ask that is
        // nothing but a link is hidden until it has an address, and the section
        // knows nothing about ids. Dropped from telegram, the section gains a
        // row pointing at a channel that does not exist; dropped from review,
        // the row survives the day the store address is ever removed and sends
        // nobody anywhere. Neither shows up as a failure anywhere else.
        it('marks both entries that are nothing but a link', () => {
            const needsUrl = SUPPORT_ACTIONS.filter((action) => action.needsUrl).map(
                (action) => action.id,
            );
            expect(needsUrl).toEqual(['review', 'telegram']);
        });
    });

    describe('supportHref', () => {
        it('passes an https link through', () => {
            expect(supportHref({ id: 'share', url: 'https://boosty.to/x' })).toBe(
                'https://boosty.to/x',
            );
        });

        // The single relaxation over httpsHref, and only one bare address of
        // it: the report line has no other way to reach anybody, the repository
        // is not public.
        it('passes one bare mail address through', () => {
            expect(supportHref({ id: 'bug', url: 'mailto:support@chakalabs.com' })).toBe(
                'mailto:support@chakalabs.com',
            );
        });

        it.each([
            ['http://boosty.to/x'],
            ['javascript:alert(1)'],
            ['/relative'],
            [''],
            [undefined],
            // Mail that is not a bare address: a letter composed for the user
            // (with a hidden copy to a third party), and a list of recipients.
            // The relaxation stops at the address itself.
            ['mailto:support@chakalabs.com?bcc=hidden@evil.test'],
            ['mailto:support@chakalabs.com,hidden@evil.test'],
            ['mailto:not-an-address'],
        ])('refuses %s', (url) => {
            expect(supportHref({ id: 'share', url })).toBeNull();
        });
    });

    // The cash-desk half of the pair. Two guards rather than one because the
    // two lists do not admit the same addresses, and the difference is the
    // whole point: what supportHref() relaxes for the report line must not
    // become a payment link, because there is no cash desk over mail.
    describe('payHref', () => {
        const method = (url: string) => ({ id: 'x', label: 'Касса', hint: 'подсказка', url });

        it('passes an https link through', () => {
            expect(payHref(method('https://boosty.to/x'))).toBe('https://boosty.to/x');
        });

        // The one address supportHref() accepts and this one must not: a bare,
        // otherwise perfectly valid mailto:. Refused here means no href, and a
        // method without an href is dropped from the section entirely (Ф8-6),
        // so a mail address in DONATION_METHODS shows nothing at all rather
        // than a cash desk that is a letter.
        it('refuses the bare mail address supportHref accepts', () => {
            const mail = method('mailto:support@chakalabs.com');
            expect(supportHref(mail)).toBe('mailto:support@chakalabs.com');
            expect(payHref(mail)).toBeNull();
        });

        it.each([['http://boosty.to/x'], ['javascript:alert(1)'], ['/relative'], ['']])(
            'refuses %s',
            (url) => {
                expect(payHref(method(url))).toBeNull();
            },
        );
    });
});
