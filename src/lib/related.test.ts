import { describe, expect, it } from 'vitest';
import {
    dedupeRelated,
    groupRelated,
    isRelationKind,
    normalizeRelationKind,
    RELATION_KIND_ORDER,
} from './related';
import type { RelatedItem, RelationKind, TitleCard } from './api/types';

// The 12 values of RelationKindEnum as introspected on 2026-08-10 (docs/03),
// written out here on purpose: if the union in types.ts loses or gains a value,
// this literal list is the second witness that says which one.
const ALL_KINDS: readonly RelationKind[] = [
    'adaptation',
    'alternative_setting',
    'alternative_version',
    'character',
    'full_story',
    'other',
    'parent_story',
    'prequel',
    'sequel',
    'side_story',
    'spin_off',
    'summary',
];

function card(overrides: Partial<TitleCard> = {}): TitleCard {
    return {
        id: '1',
        targetType: 'Anime',
        name: 'Title',
        russian: null,
        kind: 'tv',
        score: null,
        status: null,
        year: 2000,
        posterUrl: null,
        posterUrl2x: null,
        userRate: null,
        ...overrides,
    };
}

function item(kind: RelationKind, cardOverrides: Partial<TitleCard> = {}): RelatedItem {
    return {
        relationKind: kind,
        relationText: 'Связь',
        card: card(cardOverrides),
    };
}

describe('RELATION_KIND_ORDER', () => {
    it('lists every relation kind exactly once', () => {
        expect([...RELATION_KIND_ORDER].sort()).toEqual([...ALL_KINDS].sort());
    });

    it('opens with the main story line and ends with the catch-all', () => {
        expect(RELATION_KIND_ORDER.slice(0, 2)).toEqual(['sequel', 'prequel']);
        expect(RELATION_KIND_ORDER.at(-1)).toBe('other');
    });

    it('puts the source material ahead of the side branches', () => {
        const adaptation = RELATION_KIND_ORDER.indexOf('adaptation');
        expect(adaptation).toBeLessThan(RELATION_KIND_ORDER.indexOf('side_story'));
        expect(adaptation).toBeLessThan(RELATION_KIND_ORDER.indexOf('spin_off'));
        expect(adaptation).toBeGreaterThan(RELATION_KIND_ORDER.indexOf('sequel'));
    });
});

describe('isRelationKind', () => {
    it('accepts every value of the server enum', () => {
        for (const kind of ALL_KINDS) {
            expect(isRelationKind(kind)).toBe(true);
        }
    });

    it('rejects an unknown value', () => {
        expect(isRelationKind('gaiden')).toBe(false);
        expect(isRelationKind('')).toBe(false);
        expect(isRelationKind('Sequel')).toBe(false); // enum values are lower snake_case
    });

    it('rejects prototype members', () => {
        // The guard must not answer "yes" for 'toString'/'constructor' — a plain
        // `in` check would, and the row would land in a group that has no label.
        expect(isRelationKind('toString')).toBe(false);
        expect(isRelationKind('constructor')).toBe(false);
    });
});

describe('normalizeRelationKind', () => {
    it('keeps a known kind as is', () => {
        expect(normalizeRelationKind('prequel')).toBe('prequel');
    });

    it('folds an unknown kind into other', () => {
        expect(normalizeRelationKind('gaiden')).toBe('other');
        expect(normalizeRelationKind('toString')).toBe('other');
    });
});

describe('dedupeRelated', () => {
    it('drops a repeated title and keeps the higher-ranked link', () => {
        const first = item('sequel', { id: '5' });
        const again = item('other', { id: '5' });
        expect(dedupeRelated([first, again])).toEqual([first]);
    });

    it('lets the higher-ranked link win even when it arrives second', () => {
        // The contract does not forbid duplicates, and server order must not
        // decide the group: `other` first, `sequel` second still means sequel.
        const vague = item('other', { id: '5' });
        const precise = item('sequel', { id: '5' });
        expect(dedupeRelated([vague, precise])).toEqual([precise]);
    });

    it('keeps the position of the first occurrence when a later one wins', () => {
        // The winning ROW is replaced, its PLACE is not: the server order of the
        // list around it is the only order we have before grouping.
        const vague = item('other', { id: '5' });
        const neighbour = item('prequel', { id: '6' });
        const precise = item('sequel', { id: '5' });
        expect(dedupeRelated([vague, neighbour, precise])).toEqual([precise, neighbour]);
    });

    it('keeps the first row when the duplicates rank the same', () => {
        const first = item('sequel', { id: '5', year: 1999 });
        const again = item('sequel', { id: '5', year: 2015 });
        expect(dedupeRelated([first, again])).toEqual([first]);
    });

    it('ranks an unfamiliar kind as other, so a known kind beats it', () => {
        const unfamiliar: RelatedItem = {
            relationKind: 'gaiden' as RelationKind,
            relationText: 'Гайден',
            card: card({ id: '5' }),
        };
        const known = item('side_story', { id: '5' });
        expect(dedupeRelated([unfamiliar, known])).toEqual([known]);
    });

    it('keeps titles of different media that share an id', () => {
        const anime = item('sequel', { id: '5', targetType: 'Anime' });
        const manga = item('adaptation', { id: '5', targetType: 'Manga' });
        expect(dedupeRelated([anime, manga])).toEqual([anime, manga]);
    });

    it('does not touch the caller array', () => {
        const items = [item('sequel', { id: '5' }), item('sequel', { id: '5' })];
        dedupeRelated(items);
        expect(items).toHaveLength(2);
    });
});

describe('groupRelated', () => {
    it('returns no groups for an empty list', () => {
        expect(groupRelated([])).toEqual([]);
    });

    it('orders groups by relation kind, not by the order the server sent them', () => {
        const groups = groupRelated([
            item('other', { id: '1' }),
            item('adaptation', { id: '2' }),
            item('sequel', { id: '3' }),
            item('prequel', { id: '4' }),
        ]);
        expect(groups.map((group) => group.kind)).toEqual([
            'sequel',
            'prequel',
            'adaptation',
            'other',
        ]);
    });

    it('omits the kinds nothing was returned for', () => {
        const groups = groupRelated([item('sequel', { id: '1' })]);
        expect(groups).toHaveLength(1);
        expect(groups[0].kind).toBe('sequel');
    });

    it('hands the caller rows back by reference', () => {
        const row = item('sequel', { id: '1' });
        expect(groupRelated([row])[0].items[0]).toBe(row);
    });

    it('collects every row of one kind into a single group', () => {
        const groups = groupRelated([
            item('sequel', { id: '1', year: 2001 }),
            item('adaptation', { id: '2' }),
            item('sequel', { id: '3', year: 2002 }),
        ]);
        expect(groups.map((group) => group.items.map((row) => row.card.id))).toEqual([
            ['1', '3'],
            ['2'],
        ]);
    });

    it('sorts a group by year, oldest first', () => {
        const groups = groupRelated([
            item('sequel', { id: 'new', year: 2015 }),
            item('sequel', { id: 'old', year: 1999 }),
            item('sequel', { id: 'mid', year: 2004 }),
        ]);
        expect(groups[0].items.map((row) => row.card.id)).toEqual(['old', 'mid', 'new']);
    });

    it('puts undated titles after the dated ones', () => {
        const groups = groupRelated([
            item('sequel', { id: 'announced', year: null }),
            item('sequel', { id: 'aired', year: 2004 }),
            item('sequel', { id: 'unknown', year: null }),
        ]);
        // The two undated rows keep the server order between themselves — there
        // is nothing to sort them by, and stable sort is the only honest answer.
        expect(groups[0].items.map((row) => row.card.id)).toEqual([
            'aired',
            'announced',
            'unknown',
        ]);
    });

    it('keeps the server order when a whole group is undated', () => {
        // Announcements only — nothing to sort by, so the group must come out
        // exactly as the server sent it rather than in some incidental order.
        const groups = groupRelated([
            item('sequel', { id: 'a', year: null }),
            item('sequel', { id: 'b', year: null }),
            item('sequel', { id: 'c', year: null }),
        ]);
        expect(groups[0].items.map((row) => row.card.id)).toEqual(['a', 'b', 'c']);
    });

    it('leaves the caller array untouched', () => {
        // The composable keeps the flat list from the wire and groups it for
        // rendering; if grouping sorted that list in place, the cached copy
        // would quietly stop matching what the server sent.
        const items = [
            item('sequel', { id: 'new', year: 2015 }),
            item('adaptation', { id: 'src', year: 1999 }),
        ];
        groupRelated(items);
        expect(items.map((row) => row.card.id)).toEqual(['new', 'src']);
    });

    it('keeps the server order for titles of the same year', () => {
        const groups = groupRelated([
            item('sequel', { id: 'second', year: 2004 }),
            item('sequel', { id: 'first', year: 2004 }),
        ]);
        expect(groups[0].items.map((row) => row.card.id)).toEqual(['second', 'first']);
    });

    it('shows an unfamiliar relation kind under other instead of dropping it', () => {
        // The cast is the whole point of the case: the server is free to add a
        // value our union does not have, and this is what such a row looks like
        // by the time it reaches the screen.
        const unfamiliar: RelatedItem = {
            relationKind: 'gaiden' as RelationKind,
            relationText: 'Гайден',
            card: card({ id: '7' }),
        };
        const groups = groupRelated([item('sequel', { id: '1' }), unfamiliar]);
        expect(groups.map((group) => group.kind)).toEqual(['sequel', 'other']);
        expect(groups[1].items[0]).toBe(unfamiliar);
    });

    it('merges an unfamiliar kind with the real other rows', () => {
        const unfamiliar: RelatedItem = {
            relationKind: 'gaiden' as RelationKind,
            relationText: 'Гайден',
            card: card({ id: '7', year: 1990 }),
        };
        const groups = groupRelated([item('other', { id: '8', year: 2000 }), unfamiliar]);
        expect(groups).toHaveLength(1);
        expect(groups[0].items.map((row) => row.card.id)).toEqual(['7', '8']);
    });

    it('deduplicates before grouping, so a twice-linked title appears once', () => {
        const groups = groupRelated([item('sequel', { id: '5' }), item('side_story', { id: '5' })]);
        expect(groups.map((group) => group.kind)).toEqual(['sequel']);
        expect(groups[0].items).toHaveLength(1);
    });

    it('puts a twice-linked title in the higher-ranked group, whatever the server order', () => {
        // The regression this pins: dedup used to keep the FIRST row, so this
        // title stayed under «Прочее» and «Сиквелы» came out empty.
        const groups = groupRelated([item('other', { id: '5' }), item('sequel', { id: '5' })]);
        expect(groups.map((group) => group.kind)).toEqual(['sequel']);
        expect(groups[0].items).toHaveLength(1);
    });
});
