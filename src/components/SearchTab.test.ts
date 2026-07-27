import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h } from 'vue';
import type { Component } from 'vue';
import SearchTab from './SearchTab.vue';
import { i18n } from '@/src/lib/i18n';
import { clickOn, createApp, createFakeElement, find, findAll } from './fake-renderer';
import type { FakeElement } from './fake-renderer';

// UX-1: a custom clear button replaces the hidden native webkit cancel button.
// It renders only while the query is non-empty; clicking it emits an empty
// query and returns focus to the input. Mounted through the shared fake
// renderer.

interface Mounted {
    container: FakeElement;
    emitted: string[];
}

let cleanups: Array<() => void> = [];

function mountSearch(modelValue: string): Mounted {
    const emitted: string[] = [];
    const container = createFakeElement('#container');
    const app = createApp({
        render: () =>
            // Same SFC-to-Component cast as in XSelect.test.ts; runtime props
            // are the exact SearchTab contract.
            h(SearchTab as unknown as Component, {
                modelValue,
                searchType: 'anime',
                'onUpdate:modelValue': (value: string) => {
                    emitted.push(value);
                },
            }),
    });
    app.mount(container);
    cleanups.push(() => app.unmount());
    return { container, emitted };
}

beforeEach(() => {
    // No DOM in this environment; the closed type XSelect and its unmount
    // hooks only need the listener API surface of document.
    vi.stubGlobal('document', {
        addEventListener: () => {},
        removeEventListener: () => {},
    });
});

afterEach(() => {
    for (const cleanup of cleanups) {
        cleanup();
    }
    cleanups = [];
    vi.unstubAllGlobals();
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
