import { afterEach, describe, expect, it, vi } from 'vitest';
import { h } from 'vue';
import type { Component } from 'vue';
import SearchTab from './SearchTab.vue';
import type { SearchType } from '@/src/lib/api/types';
import { i18n } from '@/src/lib/i18n';
import { clickOn, createApp, createFakeElement, find, findAll, textOf } from './fake-renderer';
import type { FakeElement } from './fake-renderer';

// UX-1: a custom clear button replaces the hidden native webkit cancel button.
// It renders only while the query is non-empty; clicking it emits an empty
// query and returns focus to the input. The type filter under the field is a
// ChipGroup row (the chip contract itself lives in ChipGroup.test.ts). Mounted
// through the shared fake renderer.

interface Mounted {
    container: FakeElement;
    emitted: string[];
    emittedTypes: SearchType[];
}

let cleanups: Array<() => void> = [];

function mountSearch(modelValue: string, searchType: SearchType = 'anime'): Mounted {
    const emitted: string[] = [];
    const emittedTypes: SearchType[] = [];
    const container = createFakeElement('#container');
    const app = createApp({
        render: () =>
            // Same SFC-to-Component cast as in XSelect.test.ts; runtime props
            // are the exact SearchTab contract.
            h(SearchTab as unknown as Component, {
                modelValue,
                searchType,
                'onUpdate:modelValue': (value: string) => {
                    emitted.push(value);
                },
                'onUpdate:searchType': (value: SearchType) => {
                    emittedTypes.push(value);
                },
            }),
    });
    app.mount(container);
    cleanups.push(() => app.unmount());
    return { container, emitted, emittedTypes };
}

afterEach(() => {
    for (const cleanup of cleanups) {
        cleanup();
    }
    cleanups = [];
});

describe('SearchTab clear button (UX-1)', () => {
    it('renders no clear button while the query is empty', () => {
        const { container } = mountSearch('');
        expect(findAll(container, 'search__clear')).toHaveLength(0);
    });

    it('renders the clear button with the i18n aria-label for a non-empty query', () => {
        const { container } = mountSearch('berserk');
        const buttons = findAll(container, 'search__clear');
        expect(buttons).toHaveLength(1);
        expect(buttons[0]!.props['aria-label']).toBe('Очистить');
        expect(buttons[0]!.props['aria-label']).toBe(i18n.search.clear);
    });

    it('emits an empty update:modelValue and refocuses the input on clear', () => {
        const { container, emitted } = mountSearch('berserk');
        // The fake element has no focus(); provide a spy so the template-ref
        // refocus call is both survivable and observable.
        const focus = vi.fn();
        Object.assign(find(container, 'search__input'), { focus });

        clickOn(find(container, 'search__clear'));
        expect(emitted).toEqual(['']);
        expect(focus).toHaveBeenCalledOnce();
    });
});

describe('SearchTab type filter (UX-1)', () => {
    it('renders the three types in a labelled chip row, checking the selected one', () => {
        const { container } = mountSearch('', 'ranobe');
        expect(find(container, 'chips').props['aria-label']).toBe(i18n.search.typeFilterLabel);

        const chips = findAll(container, 'chip');
        expect(chips.map((chip) => textOf(chip).trim())).toEqual(['Аниме', 'Манга', 'Ранобэ']);
        expect(chips.map((chip) => chip.props['aria-checked'])).toEqual([false, false, true]);
    });

    it('emits update:searchType with the value of the clicked chip', () => {
        const { container, emittedTypes } = mountSearch('berserk');
        // Two different inactive chips: a mutation that emits any constant
        // cannot satisfy both expected values.
        clickOn(findAll(container, 'chip')[1]!);
        clickOn(findAll(container, 'chip')[2]!);
        expect(emittedTypes).toEqual(['manga', 'ranobe']);
    });
});
