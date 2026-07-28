import { describe, expect, it } from 'vitest';
import { titleHref } from './title-url';

// Ф6-26: the only gate between the `url` of a title record and a live href.
describe('titleHref', () => {
    it('passes an https url of either domain through unchanged', () => {
        expect(titleHref('https://shikimori.io/animes/59978-sousou-no-frieren-2nd-season')).toBe(
            'https://shikimori.io/animes/59978-sousou-no-frieren-2nd-season',
        );
        expect(titleHref('https://shikimori.one/mangas/2-berserk')).toBe(
            'https://shikimori.one/mangas/2-berserk',
        );
    });

    it('drops a record without a url (older session cache) and an explicit null', () => {
        expect(titleHref(undefined)).toBeNull();
        expect(titleHref(null)).toBeNull();
    });

    it('drops anything that is not an https link', () => {
        expect(titleHref('javascript:alert(1)')).toBeNull();
        expect(titleHref('data:text/html,<script>alert(1)</script>')).toBeNull();
        expect(titleHref('http://shikimori.io/animes/1')).toBeNull();
        expect(titleHref('/animes/1')).toBeNull();
        expect(titleHref('')).toBeNull();
        // Case matters: the scheme check is a plain prefix test, and a value
        // that needs normalising is not a value this UI should trust.
        expect(titleHref('HTTPS://shikimori.io/animes/1')).toBeNull();
    });
});
