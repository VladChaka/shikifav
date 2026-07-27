import { describe, expect, it } from 'vitest';
import { displayTitle } from './title-name';

describe('displayTitle', () => {
    describe('ru', () => {
        it('puts the Russian name first and the romaji one second', () => {
            expect(
                displayTitle({ name: 'Fullmetal Alchemist', russian: 'Стальной алхимик' }, 'ru'),
            ).toEqual({ primary: 'Стальной алхимик', secondary: 'Fullmetal Alchemist' });
        });

        it('falls back to romaji and shows no second row without a Russian name', () => {
            expect(displayTitle({ name: 'Fullmetal Alchemist', russian: null }, 'ru')).toEqual({
                primary: 'Fullmetal Alchemist',
                secondary: null,
            });
        });

        it('treats an empty Russian name as missing', () => {
            expect(displayTitle({ name: 'Berserk', russian: '' }, 'ru')).toEqual({
                primary: 'Berserk',
                secondary: null,
            });
        });
    });

    describe('romaji', () => {
        it('puts the romaji name first and the Russian one second', () => {
            expect(
                displayTitle({ name: 'Fullmetal Alchemist', russian: 'Стальной алхимик' }, 'romaji'),
            ).toEqual({ primary: 'Fullmetal Alchemist', secondary: 'Стальной алхимик' });
        });

        it('shows no second row without a Russian name', () => {
            expect(displayTitle({ name: 'Fullmetal Alchemist', russian: null }, 'romaji')).toEqual({
                primary: 'Fullmetal Alchemist',
                secondary: null,
            });
        });

        it('treats an empty Russian name as missing', () => {
            expect(displayTitle({ name: 'Berserk', russian: '' }, 'romaji')).toEqual({
                primary: 'Berserk',
                secondary: null,
            });
        });
    });

    // Shikimori has titles whose russian == name (e.g. "Monster"): the same
    // string on both rows is a rendering bug, not a translation.
    describe('russian equal to name', () => {
        it('drops the duplicated second row in ru', () => {
            expect(displayTitle({ name: 'Monster', russian: 'Monster' }, 'ru')).toEqual({
                primary: 'Monster',
                secondary: null,
            });
        });

        it('drops the duplicated second row in romaji', () => {
            expect(displayTitle({ name: 'Monster', russian: 'Monster' }, 'romaji')).toEqual({
                primary: 'Monster',
                secondary: null,
            });
        });
    });
});
