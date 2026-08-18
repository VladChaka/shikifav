import { afterEach, describe, expect, it } from 'vitest';
import { h } from 'vue';
import type { Component } from 'vue';
import ChipGroup from './ChipGroup.vue';
import { clickOn, createApp, createFakeElement, findAll, textOf } from './fake-renderer';
import type { FakeElement } from './fake-renderer';

// UX-1 filter chips: a radiogroup row switching a filter in one tap, in two
// looks — status (colored dot + .st-* palette) and neutral (type filter).
// Mounted through the shared fake renderer.

type Fruit = 'apple' | 'pear' | 'plum';

const OPTIONS = [
    { value: 'apple', label: 'Яблоко' },
    { value: 'pear', label: 'Груша' },
    { value: 'plum', label: 'Слива' },
] as const;

interface Mounted {
    container: FakeElement;
    emitted: Fruit[];
}

let cleanups: Array<() => void> = [];

function mountGroup(modelValue: Fruit, statusDots = false, disabled = false): Mounted {
    const emitted: Fruit[] = [];
    const container = createFakeElement('#container');
    const app = createApp({
        render: () =>
            // The typed SFC constructor is not directly assignable to
            // Component (same cast as in XSelect.test.ts); runtime props are
            // the exact ChipGroup contract.
            h(ChipGroup as unknown as Component, {
                options: OPTIONS,
                modelValue,
                statusDots,
                disabled,
                ariaLabel: 'Фрукт',
                'onUpdate:modelValue': (value: Fruit) => {
                    emitted.push(value);
                },
            }),
    });
    app.mount(container);
    cleanups.push(() => app.unmount());
    return { container, emitted };
}

function chips(container: FakeElement): FakeElement[] {
    return findAll(container, 'chip');
}

function classesOf(el: FakeElement): string[] {
    return typeof el.props.class === 'string' ? el.props.class.split(/\s+/) : [];
}

afterEach(() => {
    for (const cleanup of cleanups) {
        cleanup();
    }
    cleanups = [];
});

describe('ChipGroup', () => {
    it('renders one chip per option, in order', () => {
        const { container } = mountGroup('pear');
        expect(chips(container).map((chip) => textOf(chip).trim())).toEqual([
            'Яблоко',
            'Груша',
            'Слива',
        ]);
    });

    it('checks exactly the active chip inside a labelled radiogroup', () => {
        const { container } = mountGroup('pear');

        const [group] = findAll(container, 'chips');
        expect(group?.props.role).toBe('radiogroup');
        expect(group?.props['aria-label']).toBe('Фрукт');

        const all = chips(container);
        expect(all.map((chip) => chip.props.role)).toEqual(['radio', 'radio', 'radio']);
        expect(all.map((chip) => chip.props['aria-checked'])).toEqual([false, true, false]);
        expect(all.map((chip) => classesOf(chip).includes('chip--active'))).toEqual([
            false,
            true,
            false,
        ]);
    });

    it('emits the value of a clicked inactive chip', () => {
        const { container, emitted } = mountGroup('pear');
        // Two different chips: a mutation emitting any constant cannot satisfy
        // both expected values.
        clickOn(chips(container)[2]!);
        clickOn(chips(container)[0]!);
        expect(emitted).toEqual(['plum', 'apple']);
    });

    it('stays silent when the active chip is clicked', () => {
        const { container, emitted } = mountGroup('pear');
        clickOn(chips(container)[1]!);
        expect(emitted).toEqual([]);
    });

    it('tags chips with their .st-* palette and shows dots with statusDots', () => {
        const { container } = mountGroup('pear', true);
        expect(
            chips(container).map((chip) => classesOf(chip).find((c) => c.startsWith('st-'))),
        ).toEqual(['st-apple', 'st-pear', 'st-plum']);
        expect(findAll(container, 'chip__dot')).toHaveLength(3);
    });

    // Ф11-11: a row subordinate to another setting. It keeps its value on
    // screen and goes dead — no writes, and the group says so to a screen
    // reader as well.
    it('disables every chip of the row and marks the group aria-disabled', () => {
        const { container, emitted } = mountGroup('pear', false, true);

        expect(findAll(container, 'chips')[0]?.props['aria-disabled']).toBe(true);
        expect(chips(container).map((chip) => chip.props.disabled)).toEqual([true, true, true]);
        // The stored value is still the one shown: a dimmed row must not read
        // as «выключено», it reads as «вернётся сюда».
        expect(chips(container).map((chip) => classesOf(chip).includes('chip--active'))).toEqual([
            false,
            true,
            false,
        ]);

        // Real Chrome swallows the click on a disabled button; the handler is
        // guarded anyway, so nothing can write through a locked row.
        clickOn(chips(container)[0]!);
        expect(emitted).toEqual([]);
    });

    it('leaves the group free of aria-disabled while it is usable', () => {
        const { container } = mountGroup('pear');
        expect(findAll(container, 'chips')[0]?.props['aria-disabled']).toBeUndefined();
        expect(chips(container).map((chip) => chip.props.disabled)).toEqual([false, false, false]);
    });

    it('renders neutral dotless chips without statusDots', () => {
        const { container } = mountGroup('pear');
        expect(chips(container).every((chip) => classesOf(chip).includes('chip--plain'))).toBe(
            true,
        );
        expect(
            chips(container).some((chip) => classesOf(chip).some((c) => c.startsWith('st-'))),
        ).toBe(false);
        expect(findAll(container, 'chip__dot')).toHaveLength(0);
    });
});
