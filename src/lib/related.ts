import { cardKey } from './title-card';
import type { CardKey } from './title-card';
import type { RelatedItem, RelationKind } from './api/types';

// Pure layer of the related-titles screen (US-11, phase 12): ordering, grouping
// and deduplication — no chrome.*, no Vue, no network. The read layer hands over
// one flat list exactly as the server sent it (api/graphql.ts, Ф12-5) and the
// screen renders whatever comes out of here, so every decision worth arguing
// about lives in this file and is testable alone.
//
// normalizeRelationKind is the one export used outside the UI: the read layer in
// background narrows the server enum with it (docs/02).

// Reading order of the relation groups, and the tie-break when one title is
// linked twice (dedupeRelated). Rank values are plain increasing integers: the
// record is exhaustive over RelationKind by construction, so gaps for future
// insertions would buy nothing.
//
// The order follows how a person walks a franchise rather than the alphabet the
// server uses: first the main line (what comes next, what came before, the whole
// work this is a piece of), then the source material in the other medium — the
// «аниме ↔ первоисточник» hop is the reason both media are in one request at all
// (docs/06, decision 4) — then the side branches, then the alternatives and the
// trivia, and `other` last, being the bucket that promises nothing.
//
// `satisfies Record<RelationKind, number>` is the point of the record: a value
// added to the union fails to compile here instead of silently ending up
// unranked and invisible on the screen.
const RELATION_KIND_RANK = {
    sequel: 1,
    prequel: 2,
    full_story: 3,
    parent_story: 4,
    adaptation: 5,
    side_story: 6,
    spin_off: 7,
    alternative_version: 8,
    alternative_setting: 9,
    summary: 10,
    character: 11,
    other: 12,
} satisfies Record<RelationKind, number>;

// Derived, never written out a second time: a hand-kept order array next to the
// rank record would drift apart on the first inserted relation kind.
// Object.keys widens to string[], and the cast narrows it back — the record is
// exhaustive over RelationKind, so its keys cannot be anything else.
export const RELATION_KIND_ORDER: readonly RelationKind[] = (
    Object.keys(RELATION_KIND_RANK) as RelationKind[]
).sort((a, b) => RELATION_KIND_RANK[a] - RELATION_KIND_RANK[b]);

// One relation kind with its rows. Carries no heading text: anime and manga word
// the same kind differently on the wire (docs/03), so the screen looks the label
// up by `kind` in i18n and the Russian strings stay in one file (CLAUDE.md).
export interface RelatedGroup {
    kind: RelationKind;
    items: RelatedItem[];
}

export function isRelationKind(value: string): value is RelationKind {
    // Own keys only: `value in RELATION_KIND_RANK` would accept 'toString' and
    // every other prototype member as a valid relation kind.
    return Object.hasOwn(RELATION_KIND_RANK, value);
}

// A kind the union does not know goes to `other` instead of dropping the row:
// the union is our snapshot of the server enum (12 values on 2026-08-10), the
// server may extend it, and a lost title reads as a bug while an unfamiliar one
// under «Прочее» still carries the server's own Russian relationText in its meta.
export function normalizeRelationKind(value: string): RelationKind {
    return isRelationKind(value) ? value : 'other';
}

// Rank of the group a row would land in; an unfamiliar kind ranks as `other`,
// exactly as it will be grouped later.
function rankOf(item: RelatedItem): number {
    return RELATION_KIND_RANK[normalizeRelationKind(item.relationKind)];
}

// A title can be linked twice under different kinds, and two rows for one title
// read as a bug on a screen whose whole job is "what else is there". Of the
// duplicates the HIGHEST-ranked link wins, not the first one on the wire: a
// title that arrives as `other` and again as `sequel` belongs under «Сиквелы» —
// the informative label — and letting server order decide would leave it in the
// bucket that promises nothing, with «Сиквелы» empty. Ties keep the position and
// the row of the first occurrence, so the server's stable order survives.
export function dedupeRelated(items: readonly RelatedItem[]): RelatedItem[] {
    const positionByKey = new Map<CardKey, number>();
    const unique: RelatedItem[] = [];
    for (const item of items) {
        const key = cardKey(item.card);
        const position = positionByKey.get(key);
        if (position === undefined) {
            positionByKey.set(key, unique.length);
            unique.push(item);
            continue;
        }
        if (rankOf(item) < rankOf(unique[position])) {
            unique[position] = item;
        }
    }
    return unique;
}

// Inside a group: by year ascending, i.e. release order — within one kind of
// relation ("Сиквелы", "Побочные истории") that is the order a person consumes
// them in, and it survives franchises like One Piece where a group holds a dozen
// rows. `year: null` (announcements, and titles whose airedOn the API leaves
// empty) goes last rather than first: an undated entry is most often an upcoming
// one, and it must not head a group that otherwise reads as a timeline.
// Array.prototype.sort is stable (ES2019), so rows of the same year keep the
// order the server returned them in.
function byYear(a: RelatedItem, b: RelatedItem): number {
    if (a.card.year === b.card.year) {
        return 0;
    }
    if (a.card.year === null) {
        return 1;
    }
    if (b.card.year === null) {
        return -1;
    }
    return a.card.year - b.card.year;
}

// Flat server list -> groups in RELATION_KIND_ORDER, deduplicated, sorted inside.
// Empty groups are dropped: a heading with nothing under it is noise, and most
// titles use three or four of the twelve kinds.
export function groupRelated(items: readonly RelatedItem[]): RelatedGroup[] {
    const byKind = new Map<RelationKind, RelatedItem[]>();
    for (const item of dedupeRelated(items)) {
        // Normalized here as well, not only in the mapper: `relationKind` is
        // typed as RelationKind but its value comes from the server, and this
        // module must not depend on someone upstream having sanitized it.
        const kind = normalizeRelationKind(item.relationKind);
        const bucket = byKind.get(kind);
        if (bucket) {
            bucket.push(item);
        } else {
            byKind.set(kind, [item]);
        }
    }
    const groups: RelatedGroup[] = [];
    for (const kind of RELATION_KIND_ORDER) {
        const bucket = byKind.get(kind);
        if (bucket) {
            groups.push({ kind, items: bucket.sort(byYear) });
        }
    }
    return groups;
}
