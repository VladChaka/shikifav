import { describe, expect, it } from 'vitest';
import {
    BADGE_MAX,
    badgeText,
    sanitizeBadgeRows,
    withRateProgress,
    withoutRate,
} from './badge-backlog';
import type { BadgeRow } from './badge-backlog';
import { countTitlesBehind } from './calendar-schedule';

function row(rateId: string, episodesAired: number, progress: number): BadgeRow {
    return { rateId, episodesAired, progress };
}

describe('badgeText', () => {
    it('hides the badge on zero instead of drawing «0»', () => {
        expect(badgeText(0)).toBe('');
    });

    // Defensive: the count is built by countTitlesBehind and cannot be negative,
    // but an empty badge is the only sane answer if it ever were.
    it('hides the badge on a negative count', () => {
        expect(badgeText(-1)).toBe('');
    });

    it('prints small counts as they are', () => {
        expect(badgeText(1)).toBe('1');
        expect(badgeText(12)).toBe('12');
    });

    // The cap exists because Chrome cuts the badge to about four characters: an
    // uncapped 128 would render as «12», which is a silent lie (docs/06, Ф11-9).
    it('prints the last exact number at the ceiling', () => {
        expect(badgeText(BADGE_MAX)).toBe('99');
    });

    it('caps anything above the ceiling with 99+', () => {
        expect(badgeText(BADGE_MAX + 1)).toBe('99+');
        expect(badgeText(128)).toBe('99+');
        expect(badgeText(1000)).toBe('99+');
    });

    it('never renders more than four characters', () => {
        for (const count of [0, 1, 9, 10, 99, 100, 5000]) {
            expect(badgeText(count).length).toBeLessThanOrEqual(4);
        }
    });
});

describe('withRateProgress', () => {
    const rows = [row('1', 8, 5), row('2', 3, 3)];

    it('replaces the progress of the matching row only', () => {
        expect(withRateProgress(rows, '1', 8)).toEqual([row('1', 8, 8), row('2', 3, 3)]);
    });

    it('leaves the source array untouched', () => {
        withRateProgress(rows, '1', 8);
        expect(rows).toEqual([row('1', 8, 5), row('2', 3, 3)]);
    });

    // Identity is the contract the caller skips a storage write and a redraw by
    // (src/lib/badge.ts): a write about a title the badge does not count — a
    // manga, a rate from outside the poll — must cost nothing.
    it('returns the same array when the rate is unknown', () => {
        expect(withRateProgress(rows, '404', 1)).toBe(rows);
    });

    it('returns the same array when the progress did not move', () => {
        expect(withRateProgress(rows, '2', 3)).toBe(rows);
    });

    it('accepts progress moving backwards (a correction made on the site)', () => {
        expect(withRateProgress(rows, '1', 2)).toEqual([row('1', 8, 2), row('2', 3, 3)]);
    });

    it('takes a title off the count once its progress catches up', () => {
        expect(countTitlesBehind(rows)).toBe(1);
        expect(countTitlesBehind(withRateProgress(rows, '1', 8))).toBe(0);
    });
});

describe('withoutRate', () => {
    const rows = [row('1', 8, 5), row('2', 3, 3)];

    it('drops the matching row', () => {
        expect(withoutRate(rows, '1')).toEqual([row('2', 3, 3)]);
    });

    it('returns the same array when the rate is unknown', () => {
        expect(withoutRate(rows, '404')).toBe(rows);
    });

    it('leaves the source array untouched', () => {
        withoutRate(rows, '1');
        expect(rows).toHaveLength(2);
    });
});

describe('sanitizeBadgeRows', () => {
    it('reads a well-formed list back', () => {
        const rows = [row('1', 8, 5), row('2', 3, 0)];
        expect(sanitizeBadgeRows(rows)).toEqual(rows);
    });

    it('treats a missing key as nothing waiting', () => {
        expect(sanitizeBadgeRows(undefined)).toEqual([]);
        expect(sanitizeBadgeRows(null)).toEqual([]);
    });

    // Storage is untrusted input: another build may have written an object here
    // (the shape of the key could change), and indexing it would throw.
    it('refuses anything that is not an array', () => {
        expect(sanitizeBadgeRows({ '1': 5 })).toEqual([]);
        expect(sanitizeBadgeRows('99')).toEqual([]);
    });

    it('drops rows with a broken count and keeps the healthy ones', () => {
        const value = [
            row('1', 8, 5),
            { rateId: '2', episodesAired: Number.NaN, progress: 1 },
            { rateId: '3', episodesAired: 4, progress: -1 },
            { rateId: '4', episodesAired: 4.5, progress: 1 },
            { rateId: 5, episodesAired: 4, progress: 1 },
            { episodesAired: 4, progress: 1 },
            null,
            'row',
        ];
        expect(sanitizeBadgeRows(value)).toEqual([row('1', 8, 5)]);
    });

    // The whole point of the guard: a NaN reaching the arithmetic would make
    // `episodesAired - progress > 0` false-y in silence and put an invented
    // number on the icon.
    it('leaves nothing that could reach the count as NaN', () => {
        const rows = sanitizeBadgeRows([{ rateId: '1', episodesAired: Number.NaN, progress: 0 }]);
        expect(countTitlesBehind(rows)).toBe(0);
    });
});
