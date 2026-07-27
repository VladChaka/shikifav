import { describe, expect, it } from 'vitest';
import { mediaOf, statusLabel } from './i18n';

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
