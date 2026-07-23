import { ref } from 'vue';
import type { Ref } from 'vue';
import { sendMessage } from '../lib/messaging';
import { getSession, setSession } from '../lib/storage';
import type { ApiError, SearchType, TitleCard } from '../lib/api/types';

// Search list states (docs/05): 'idle' is the "type a title" hint shown for an
// empty or too-short query; 'loading' means skeleton (nothing to show yet).
export type SearchStatus = 'idle' | 'loading' | 'data' | 'empty' | 'error';

export interface UseSearch {
    query: Ref<string>;
    status: Ref<SearchStatus>;
    items: Ref<TitleCard[]>;
    error: Ref<ApiError | undefined>;
    setQuery: (value: string) => void;
    retry: () => void;
}

export const SEARCH_DEBOUNCE_MS = 300;
// docs/05 leaves the threshold open; 1-char queries are noise and waste the
// rate budget, so searching starts at 2 characters (Ф2-6 decision).
export const MIN_QUERY_LENGTH = 2;

// Fixed until the Аниме/Манга/Ранобэ selector arrives (phase 4).
const SEARCH_TYPE: SearchType = 'anime';

// Module-level state: the popup is a single short-lived instance, so every
// component shares one search session (same pattern as use-auth).
const query = ref('');
const status = ref<SearchStatus>('idle');
const items = ref<TitleCard[]>([]);
const error = ref<ApiError | undefined>(undefined);

let initialized = false;
// User already typed something: the async session-cache restore must not
// overwrite live state when it finally resolves.
let touched = false;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
// Monotonic id: only the response of the LAST dispatched request is applied,
// late responses of older requests are dropped (docs/05).
let requestSeq = 0;
// Last dispatched (or cache-restored) query — what retry() re-runs.
let lastQuery = '';

function setQuery(value: string): void {
    touched = true;
    query.value = value;
    if (debounceTimer !== undefined) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
    }
    const trimmed = value.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
        // No network for short queries; bumping the seq also invalidates any
        // in-flight response so it cannot resurrect stale results.
        // Deliberate (Ф2-7): session.lastSearch is NOT cleared here — the last
        // successful search keeps feeding the instant first render of the next
        // popup open (docs/05), even after the user clears the field.
        requestSeq += 1;
        status.value = 'idle';
        items.value = [];
        error.value = undefined;
        return;
    }
    debounceTimer = setTimeout(() => {
        debounceTimer = undefined;
        void dispatch(trimmed);
    }, SEARCH_DEBOUNCE_MS);
}

async function dispatch(searchQuery: string): Promise<void> {
    lastQuery = searchQuery;
    const requestId = ++requestSeq;
    error.value = undefined;
    // Skeleton only when there is nothing on screen: a repeat search keeps the
    // previous results visible until the response arrives (docs/05: the network
    // catches up and updates).
    status.value = items.value.length > 0 ? 'data' : 'loading';

    const response = await sendMessage('search.titles', {
        query: searchQuery,
        type: SEARCH_TYPE,
    });
    if (requestId !== requestSeq) {
        return; // stale response of an older request
    }
    if (response.ok) {
        items.value = response.data.items;
        status.value = response.data.items.length > 0 ? 'data' : 'empty';
        // Session cache feeds the instant first render of the next popup open
        // (docs/02); fire-and-forget, a write failure only loses the cache.
        void setSession('lastSearch', {
            query: searchQuery,
            type: SEARCH_TYPE,
            items: response.data.items,
        });
    } else {
        // Previous results stay in `items`: a successful retry re-renders
        // instantly and an aborted retry loses nothing.
        error.value = response.error;
        status.value = 'error';
    }
}

function retry(): void {
    if (lastQuery.trim().length >= MIN_QUERY_LENGTH) {
        void dispatch(lastQuery);
    }
}

// Instant first render from the session cache (docs/05); no automatic refetch —
// the network catches up after the next input or retry.
async function restoreFromCache(): Promise<void> {
    const cached = await getSession('lastSearch');
    if (!cached || touched) {
        return;
    }
    query.value = cached.query;
    items.value = cached.items;
    status.value = cached.items.length > 0 ? 'data' : 'empty';
    lastQuery = cached.query;
}

export function useSearch(): UseSearch {
    if (!initialized) {
        initialized = true;
        void restoreFromCache();
    }
    return { query, status, items, error, setQuery, retry };
}
