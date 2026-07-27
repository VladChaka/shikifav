import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { MAX_QUERY_LENGTH, buildSearchPageUrl, parseSearchQuery, sanitizeQuery } from './search-url';

// Ф5: the context menu writes search.html?q=… and the search page reads it back,
// so build/parse must survive the same string (Cyrillic, URL metacharacters) and
// a hand-edited URL must not smuggle a paragraph into the API query.

describe('sanitizeQuery', () => {
    it('collapses newlines, tabs and repeated spaces into single spaces', () => {
        expect(sanitizeQuery('Стальной\nалхимик\t\tБратство')).toBe('Стальной алхимик Братство');
        expect(sanitizeQuery('one   two')).toBe('one two');
        expect(sanitizeQuery('line\r\nbreak')).toBe('line break');
    });

    it('trims the surrounding whitespace of a selection', () => {
        expect(sanitizeQuery('  \n Frieren \t ')).toBe('Frieren');
    });

    it('returns an empty string for an empty or whitespace-only selection', () => {
        expect(sanitizeQuery('')).toBe('');
        expect(sanitizeQuery('   ')).toBe('');
        expect(sanitizeQuery('\n\t \r\n')).toBe('');
    });

    it('keeps a query of exactly MAX_QUERY_LENGTH untouched', () => {
        const exact = 'a'.repeat(MAX_QUERY_LENGTH);
        expect(sanitizeQuery(exact)).toBe(exact);
    });

    it('cuts a longer selection down to MAX_QUERY_LENGTH', () => {
        const long = 'б'.repeat(MAX_QUERY_LENGTH + 50);
        const result = sanitizeQuery(long);
        expect(result).toHaveLength(MAX_QUERY_LENGTH);
        expect(result).toBe('б'.repeat(MAX_QUERY_LENGTH));
    });

    it('leaves no trailing space when the cut lands on one', () => {
        // The character at the cut boundary is a space: a naive slice would keep
        // it and send "…word " to the API.
        const paragraph = `${'a'.repeat(MAX_QUERY_LENGTH - 1)} tail of the paragraph`;
        const result = sanitizeQuery(paragraph);
        expect(result).toBe('a'.repeat(MAX_QUERY_LENGTH - 1));
        expect(result).not.toMatch(/\s$/);
    });

    it('collapses first and cuts second, so whitespace does not eat the budget', () => {
        const spaced = `${'ab   '.repeat(40)}`; // 200 chars raw, 120 collapsed
        const result = sanitizeQuery(spaced);
        expect(result.length).toBeLessThanOrEqual(MAX_QUERY_LENGTH);
        expect(result.startsWith('ab ab ab')).toBe(true);
        expect(result).not.toMatch(/ {2}/);
    });
});

describe('buildSearchPageUrl + parseSearchQuery', () => {
    beforeEach(() => {
        fakeBrowser.reset();
    });

    it('points at the search page of this extension', () => {
        const url = new URL(buildSearchPageUrl('frieren'));
        expect(url.pathname).toBe('/search.html');
        expect(url.protocol).toBe('chrome-extension:');
    });

    it.each([
        ['cyrillic', 'Стальной алхимик'],
        ['ampersand', 'Fate & Stay Night'],
        ['hash', 'Yu-Gi-Oh! #1'],
        ['plus', 'Gintama+'],
        ['question mark', 'Nichijou?'],
        ['percent', '100% Doubt'],
        ['everything at once', 'Ранобэ & manga #2 + 50% ?'],
    ])('round-trips a query with %s', (_name, query) => {
        const url = buildSearchPageUrl(query);
        expect(parseSearchQuery(new URL(url).search)).toBe(query);
    });

    it('percent-encodes the raw metacharacters instead of leaking them into the URL', () => {
        const url = buildSearchPageUrl('a&b#c');
        // A single query parameter: '&' and '#' must not split it or start a hash.
        expect(new URL(url).hash).toBe('');
        expect([...new URL(url).searchParams.keys()]).toEqual(['q']);
    });

    it('builds a URL without the q parameter for an empty selection', () => {
        for (const empty of ['', '   ', '\n\t']) {
            const url = new URL(buildSearchPageUrl(empty));
            expect(url.searchParams.has('q')).toBe(false);
            expect(url.search).toBe('');
        }
    });

    it('sanitizes the selection before putting it into the URL', () => {
        const url = new URL(buildSearchPageUrl('  Steins;Gate\n\n0  '));
        expect(url.searchParams.get('q')).toBe('Steins;Gate 0');
    });

    it('reads the query with and without the leading question mark', () => {
        expect(parseSearchQuery('?q=frieren')).toBe('frieren');
        expect(parseSearchQuery('q=frieren')).toBe('frieren');
    });

    it('returns an empty string when q is missing, empty or the search is empty', () => {
        expect(parseSearchQuery('')).toBe('');
        expect(parseSearchQuery('?')).toBe('');
        expect(parseSearchQuery('?page=2')).toBe('');
        expect(parseSearchQuery('?q=')).toBe('');
        expect(parseSearchQuery('?q=%20%20')).toBe('');
    });

    it('sanitizes a hand-written URL: a pasted paragraph is collapsed and cut', () => {
        const paragraph = `Первая строка\nвторая   строка ${'x'.repeat(300)}`;
        const parsed = parseSearchQuery(`?q=${encodeURIComponent(paragraph)}`);
        expect(parsed).toHaveLength(MAX_QUERY_LENGTH);
        expect(parsed.startsWith('Первая строка вторая строка ')).toBe(true);
        expect(parsed).not.toContain('\n');
    });
});
