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
                // A donation link that does not survive the guard would render
                // as dead text — worse than not offering the method at all.
                expect(supportHref(method)).toBe(method.url);
            }
        });
    });

    describe('SUPPORT_ACTIONS', () => {
        // The free ways to help cost nothing to offer, so they are always there.
        it('offers the three free ways to help', () => {
            expect(SUPPORT_ACTIONS.map((action) => action.id)).toEqual(['review', 'share', 'bug']);
        });

        it('gives every action a label and a hint', () => {
            for (const action of SUPPORT_ACTIONS) {
                expect(action.label).not.toBe('');
                expect(action.hint).not.toBe('');
            }
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
    });

    describe('supportHref', () => {
        it('passes an https link through', () => {
            expect(
                supportHref({ id: 'x', label: 'x', hint: 'x', url: 'https://boosty.to/x' }),
            ).toBe('https://boosty.to/x');
        });

        it.each([
            ['http://boosty.to/x'],
            ['javascript:alert(1)'],
            ['/relative'],
            [''],
            [undefined],
        ])('refuses %s', (url) => {
            expect(supportHref({ id: 'x', label: 'x', hint: 'x', url })).toBeNull();
        });
    });
});
