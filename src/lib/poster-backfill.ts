import { cardKey, splitCardsByType } from './title-card';
import { sendMessage } from './messaging';
import type { CardKey } from './title-card';
import type { SearchType, TitleCard } from './api/types';

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

// Keyed by whatever the caller's idOf() returns — a bare title id everywhere a
// list holds one kind of title (search, lists, calendar). Read with applyPosters.
export type PosterMap = Record<string, string>;

// Keyed by cardKey(), because a mixed list has no bare-id identity at all
// (poster of anime 21 vs manga 21). A DIFFERENT type on purpose, and not just a
// differently keyed record: `applyPosters(cards, mixed, cardId)` would compile,
// send three requests and set not a single poster — silently, because a lookup
// that finds nothing is indistinguishable from "the server had no picture". A
// Map is not assignable to PosterMap, so that line no longer compiles, and the
// branded key stops `mixed.get(card.id)` too. Read with applyMixedPosters.
export type MixedPosterMap = ReadonlyMap<CardKey, string>;

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

const cardId = (card: TitleCard): string => card.id;

// The related screen (phase 12) shows anime, manga and ranobe in one column,
// while posters.fetch carries exactly one SearchType. Of the two ways out —
// widen the message to a list of buckets, or send it up to three times — the
// second is the smaller change AND the cheaper one: the three REST indexes are
// three separate endpoints (api/posters.ts), so Shikimori sees the same three
// requests either way, and a bucketed payload would rewrite search, lists and
// calendar for a shape only one screen needs. Rule 2 is about never asking per
// title; three buckets for a whole screen is not that.
//
// Sent in parallel because the three answers are independent and the limiter
// (4 rps) is the thing that decides pacing anyway; an empty bucket costs no
// request at all (fetchMissingPosters returns early).
export async function fetchMissingMixedPosters(
    cards: readonly TitleCard[],
): Promise<MixedPosterMap> {
    const buckets = splitCardsByType(cards);
    // Keyed by (targetType, id), not by bare id: three id-keyed maps merged flat
    // would hang anime 21's poster on manga 21.
    const merged = new Map<CardKey, string>();
    // Object.entries widens the keys to string, and the cast narrows them back —
    // splitCardsByType builds the record over SearchType and puts nothing else
    // in it.
    await Promise.all(
        (Object.entries(buckets) as [SearchType, TitleCard[]][]).map(async ([type, bucket]) => {
            const posters = await fetchMissingPosters(bucket, type, cardId);
            for (const card of bucket) {
                const url = posters[card.id];
                if (url !== undefined) {
                    merged.set(cardKey(card), url);
                }
            }
        }),
    );
    return merged;
}

// Pure: returns a patched copy, or null when nothing changed (so the caller can
// skip both the reactive write and the session-cache write). Items that already
// have a poster are never touched — the GraphQL url wins over the backfilled one.
export function applyPosters<T extends PosterHolder>(
    items: readonly T[],
    posters: PosterMap,
    idOf: (item: T) => string,
): T[] | null {
    return patchPosters(items, (item) => posters[idOf(item)]);
}

// Mixed counterpart of applyPosters. The key function is NOT a parameter here:
// the map came out of fetchMissingMixedPosters keyed by cardKey, so the only
// correct lookup is cardKey — and a caller who could pass its own would sooner
// or later pass the bare id.
export function applyMixedPosters<T extends TitleCard>(
    cards: readonly T[],
    posters: MixedPosterMap,
): T[] | null {
    return patchPosters(cards, (card) => posters.get(cardKey(card)));
}

function patchPosters<T extends PosterHolder>(
    items: readonly T[],
    urlOf: (item: T) => string | undefined,
): T[] | null {
    let changed = false;
    const next = items.map((item) => {
        if (item.posterUrl) {
            return item;
        }
        const url = urlOf(item);
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
