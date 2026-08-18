import { browser } from 'wxt/browser';

// Single place that builds and reads search.html?q=… — the context menu (ф.5)
// writes the URL, the search page reads it back.

// A context-menu selection can be a whole paragraph; the API query stays short.
export const MAX_QUERY_LENGTH = 100;

export function sanitizeQuery(raw: string): string {
    const collapsed = raw.replace(/\s+/g, ' ').trim();
    // Code points, not UTF-16 units (Ф11 audit, пункт 12): a selection of emoji
    // is twice as long by `.length`, and a cut by units breaks a surrogate pair
    // — the half that survives is a lone surrogate, which the URL serializer
    // then turns into U+FFFD inside `?q=`.
    const characters = [...collapsed];
    if (characters.length <= MAX_QUERY_LENGTH) {
        return collapsed;
    }
    // trimEnd: the cut can land on a space, which would otherwise ride along
    // into the query string.
    return characters.slice(0, MAX_QUERY_LENGTH).join('').trimEnd();
}

export function buildSearchPageUrl(raw: string): string {
    const url = new URL(browser.runtime.getURL('/search.html'));
    const query = sanitizeQuery(raw);
    if (query.length > 0) {
        // searchParams does the percent-encoding; no manual encodeURIComponent.
        url.searchParams.set('q', query);
    }
    return url.toString();
}

// `search` is location.search (leading '?' optional). Sanitized again because
// the URL may have been typed or edited by hand.
export function parseSearchQuery(search: string): string {
    return sanitizeQuery(new URLSearchParams(search).get('q') ?? '');
}
