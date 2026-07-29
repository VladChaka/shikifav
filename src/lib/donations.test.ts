import { describe, expect, it } from 'vitest';
import { DONATION_METHODS, SUPPORT_ACTIONS, supportHref } from './donations';

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
                expect(supportHref(method)).toBe(method.url);
            }
        });
    });

    describe('SUPPORT_ACTIONS', () => {
        // The free ways to help cost nothing to offer, so they are always there.
        // Their wording is picked from i18n by these ids (options.help*), so a
        // rename here silently empties a row.
        it('offers the three free ways to help', () => {
            expect(SUPPORT_ACTIONS.map((action) => action.id)).toEqual(['review', 'share', 'bug']);
        });

        // The store listing does not exist yet and the repository is not
        // published: an action without a link is a valid state, rendered as
        // plain text. One with a link must still pass the https guard.
        it('either carries an https link or none at all', () => {
            for (const action of SUPPORT_ACTIONS) {
                if (action.url === undefined) {
                    expect(supportHref(action)).toBeNull();
                } else {
                    expect(supportHref(action)).toBe(action.url);
                }
            }
        });

        // A review is left on the store page and nowhere else, so the entry
        // must stay out of the section until that page exists — the flag is
        // what hides it, and the section knows nothing about ids.
        it('marks the review as an action that is nothing but a link', () => {
            const review = SUPPORT_ACTIONS.find((action) => action.id === 'review');
            expect(review?.needsUrl).toBe(true);
        });
    });

    describe('supportHref', () => {
        it('passes an https link through', () => {
            expect(supportHref({ id: 'share', url: 'https://boosty.to/x' })).toBe(
                'https://boosty.to/x',
            );
        });

        it.each([
            ['http://boosty.to/x'],
            ['javascript:alert(1)'],
            ['/relative'],
            [''],
            [undefined],
        ])('refuses %s', (url) => {
            expect(supportHref({ id: 'share', url })).toBeNull();
        });
    });
});
