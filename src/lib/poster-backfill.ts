import { sendMessage } from './messaging';
import type { SearchType } from './api/types';

// UI half of the poster chain (Ф6-27): GraphQL poster -> REST backfill -> local
// fallback image in the component. Shared by the search results and the list
// rows, which differ only in where the title id lives (TitleCard.id vs
// RateRow.targetId).
//
// Two steps on purpose: the fetch is awaited by nobody on the render path (the
// items are already on screen), and applying the result is a pure function the
// caller runs against the CURRENT array — so an optimistic row edit made while
// the request was in flight is not overwritten.

// Both card and row carry the poster pair; the backfill only ever fills the 1x
// url (see applyPosters).
export interface PosterHolder {
    posterUrl: string | null;
    posterUrl2x?: string | null;
}

export type PosterMap = Record<string, string>;

// Asks background for the posters of the items whose poster is empty. One
// message per page of results — never one per title (CLAUDE.md rule 2).
// Failures are silent: this is not a user action, so no toast and no error
// state — the items simply keep their local fallback (docs/05).
export async function fetchMissingPosters<T extends PosterHolder>(
    items: readonly T[],
    type: SearchType,
    idOf: (item: T) => string,
): Promise<PosterMap> {
    const ids: string[] = [];
    for (const item of items) {
        if (!item.posterUrl) {
            ids.push(idOf(item));
        }
    }
    if (ids.length === 0) {
        return {}; // nothing missing — no request at all
    }
    const response = await sendMessage('posters.fetch', { type, ids });
    return response.ok ? response.data.posters : {};
}

// Pure: returns a patched copy, or null when nothing changed (so the caller can
// skip both the reactive write and the session-cache write). Items that already
// have a poster are never touched — the GraphQL url wins over the backfilled one.
export function applyPosters<T extends PosterHolder>(
    items: readonly T[],
    posters: PosterMap,
    idOf: (item: T) => string,
): T[] | null {
    let changed = false;
    const next = items.map((item) => {
        if (item.posterUrl) {
            return item;
        }
        const url = posters[idOf(item)];
        if (url === undefined) {
            return item;
        }
        changed = true;
        // No 2x pair: the REST sizes that could act as retina have a different
        // aspect ratio than the box (see POSTER_SIZE in api/posters.ts), and a
        // srcset of two differently cropped images looks worse than one.
        return { ...item, posterUrl: url, posterUrl2x: null };
    });
    return changed ? next : null;
}
