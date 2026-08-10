import { describe, expect, it } from 'vitest';
import { i18n, mediaOf, relationGroupLabel, shownOfMessage, statusLabel } from './i18n';
import { RELATION_KIND_ORDER } from './related';
import type { RelatedItem, RelationKind, TitleCard } from './api/types';

describe('mediaOf', () => {
    it('maps Anime to the anime wording and Manga (incl. ranobe cards) to book', () => {
        expect(mediaOf('Anime')).toBe('anime');
        expect(mediaOf('Manga')).toBe('book');
    });
});

describe('statusLabel', () => {
    // The statusesBook section is partial: a wrong (even if type-valid) key
    // would silently fall back to the anime label — each of the three overrides
    // is pinned to its exact Russian text here.
    it('uses the book override for watching', () => {
        expect(statusLabel('watching', 'book')).toBe('Читаю');
    });

    it('uses the book override for rewatching', () => {
        expect(statusLabel('rewatching', 'book')).toBe('Перечитываю');
    });

    it('uses the book override for completed', () => {
        expect(statusLabel('completed', 'book')).toBe('Прочитано');
    });

    it('falls back to the shared labels for book statuses without an override', () => {
        expect(statusLabel('planned', 'book')).toBe('Запланировано');
        expect(statusLabel('on_hold', 'book')).toBe('Отложено');
        expect(statusLabel('dropped', 'book')).toBe('Брошено');
    });

    it('defaults to the anime wording when no media is given', () => {
        expect(statusLabel('watching')).toBe('Смотрю');
        expect(statusLabel('rewatching')).toBe('Пересматриваю');
        expect(statusLabel('completed')).toBe('Просмотрено');
        expect(statusLabel('planned')).toBe('Запланировано');
        expect(statusLabel('on_hold')).toBe('Отложено');
        expect(statusLabel('dropped')).toBe('Брошено');
    });
});

// One row of a relation group; only the medium of the card matters to the
// heading, so everything else is left empty on purpose.
function row(targetType: TitleCard['targetType'], kind: string | null = null): RelatedItem {
    return {
        relationKind: 'adaptation',
        relationText: 'Адаптация',
        card: {
            id: '1',
            targetType,
            name: 'Title',
            russian: null,
            kind,
            score: null,
            status: null,
            year: null,
            posterUrl: null,
            posterUrl2x: null,
            userRate: null,
        },
    };
}

describe('relationGroupLabel', () => {
    // Every kind but `adaptation` reads the same whichever medium the rows are.
    // Written out as an exhaustive record: dropping a kind from the union makes
    // this table stop compiling, so the second witness of the wording cannot
    // quietly lose a line.
    const directionFree = {
        sequel: 'Продолжение',
        prequel: 'Предыстория',
        full_story: 'Полная история',
        parent_story: 'Основная история',
        side_story: 'Побочные истории',
        spin_off: 'Ответвления',
        alternative_version: 'Другие версии',
        alternative_setting: 'Другая вселенная',
        summary: 'Пересказы',
        character: 'Общие персонажи',
        other: 'Прочее',
    } satisfies Record<Exclude<RelationKind, 'adaptation'>, string>;

    it('gives the same heading to a direction-free kind whatever the rows are', () => {
        for (const [kind, label] of Object.entries(directionFree)) {
            expect(relationGroupLabel(kind as RelationKind, [row('Anime')])).toBe(label);
            expect(relationGroupLabel(kind as RelationKind, [row('Manga')])).toBe(label);
        }
    });

    // Iterating the order the screen renders in, not a list written out here:
    // a kind added to the union arrives through RELATION_KIND_ORDER and fails
    // this test unless it also got a Russian heading.
    it('has a Russian heading for every relation kind the screen can render', () => {
        for (const kind of RELATION_KIND_ORDER) {
            const label = relationGroupLabel(kind, [row('Anime')]);
            expect(label.length).toBeGreaterThan(0);
            expect(label).not.toBe(kind);
        }
    });

    it('reads an all-anime adaptation group as the screen adaptations', () => {
        expect(relationGroupLabel('adaptation', [row('Anime'), row('Anime')])).toBe('Экранизации');
    });

    it('reads a manga row as the source the story came from', () => {
        expect(relationGroupLabel('adaptation', [row('Manga')])).toBe('Первоисточник');
    });

    // A ranobe card carries targetType 'Manga' (api/types), so it must land on
    // the book side without any kind check.
    it('reads a ranobe row as the source as well', () => {
        expect(relationGroupLabel('adaptation', [row('Manga', 'light_novel')])).toBe(
            'Первоисточник',
        );
    });

    // The server may mix media in one group; whichever end the book sits at, the
    // heading must be the same one — «Экранизации» over a manga row would be
    // plainly false, while an anime under «Первоисточник» is only imprecise.
    it('heads a mixed adaptation group as the source, whatever the row order', () => {
        expect(relationGroupLabel('adaptation', [row('Anime'), row('Manga')])).toBe(
            'Первоисточник',
        );
        expect(relationGroupLabel('adaptation', [row('Manga'), row('Anime')])).toBe(
            'Первоисточник',
        );
    });
});

describe('shownOfMessage', () => {
    it('fills both placeholders of the counter', () => {
        expect(shownOfMessage(30, 92)).toBe('Показано 30 из 92');
    });

    it('leaves no placeholder token in the text', () => {
        expect(shownOfMessage(60, 92)).not.toContain('{');
    });
});

describe('i18n.related entry points', () => {
    // Three labels for one navigation, and each is pinned: `open` is the
    // accessible name of the control in TitleCard, of the control in RateRow and
    // at the same time the visible text of the StatusMenu item, so a change here
    // moves all three at once — that is the point of the single key.
    it('keeps one accessible name and two visible labels for the two entry points', () => {
        expect(i18n.related.open).toBe('Связанные тайтлы');
        expect(i18n.related.openLabel).toBe('Связанные');
        expect(i18n.related.openLabelShort).toBe('Связи');
    });

    it('names the screen the same word the visible search-card label uses', () => {
        expect(i18n.related.title).toBe(i18n.related.openLabel);
    });
});
