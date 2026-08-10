import type { SearchType, TitleCard } from './api/types';

// Pure helpers over TitleCard: who a card IS (cardKey) and which REST index can
// answer for its poster (posterTypeOf / splitCardsByType). No chrome.*, no Vue,
// no network — search, lists, the calendar and the related screen all need this,
// so it must not live in any one of their modules (docs/02, module tree).

// A card key is a string, but not every string is a card key: the brand makes
// `posters.get(card.id)` a compile error instead of a lookup that finds nothing.
// It exists only at compile time — the value is a plain string at runtime.
declare const cardKeyBrand: unique symbol;
export type CardKey = string & { readonly [cardKeyBrand]: true };

// Identity of a title in a MIXED list is the pair (targetType, id): anime and
// manga number their titles independently, so id alone puts two different works
// under one key, while ranobe shares the id space of manga and needs no third
// namespace. Related.id — the id of the LINK, volatile between requests — is not
// an option (docs/03).
//
// Spelled once and imported: the dedup of the related screen (related.ts) and
// the poster merge (poster-backfill.ts) must agree on what "the same title"
// means, and two literal template strings would drift.
export function cardKey(card: TitleCard): CardKey {
    return `${card.targetType}:${card.id}` as CardKey;
}

// MangaKindEnum values the site calls «ранобэ». Single source of truth: the
// mangas() kind filter of the search (SEARCH_TYPE_TO_KIND, api/graphql.ts) is
// built from this very list, so the two cannot drift apart — a drift would route
// a ranobe to /api/mangas?ids=, which drops light novels silently (docs/03), and
// the poster would just never arrive.
export const RANOBE_KINDS = ['light_novel', 'novel'] as const;

// Which REST v1 index can answer for this card's poster (api/posters.ts).
export function posterTypeOf(card: TitleCard): SearchType {
    if (card.targetType === 'Anime') {
        return 'anime';
    }
    // An unknown kind lands in `manga`, the wider of the two book indexes:
    // /api/mangas?ids= silently drops light novels, so a wrong guess costs one
    // missing poster either way, and guessing `manga` is wrong less often.
    return card.kind !== null && isRanobeKind(card.kind) ? 'ranobe' : 'manga';
}

// readonly ['light_novel', 'novel'] does not accept a widened string in
// .includes(), and widening the constant would give up the exhaustiveness the
// search filter is built on — so the comparison is spelled out here instead.
function isRanobeKind(kind: string): boolean {
    return RANOBE_KINDS.some((ranobeKind) => ranobeKind === kind);
}

// A related list mixes anime, manga and ranobe by construction, while a
// posters.fetch message carries exactly ONE SearchType (docs/02) and ranobe needs
// its own REST endpoint (api/posters.ts). Hence three buckets: the screen sends
// at most three messages for the whole page — still one message per page of
// results, never one per title (CLAUDE.md rule 2). Empty buckets are returned as
// empty arrays, and fetchMissingPosters already answers `{}` without a request
// for them (poster-backfill.ts).
export function splitCardsByType(cards: readonly TitleCard[]): Record<SearchType, TitleCard[]> {
    const buckets: Record<SearchType, TitleCard[]> = { anime: [], manga: [], ranobe: [] };
    for (const card of cards) {
        buckets[posterTypeOf(card)].push(card);
    }
    return buckets;
}
