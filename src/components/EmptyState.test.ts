import { afterEach, describe, expect, it } from 'vitest';
import { h } from 'vue';
import type { Component } from 'vue';
import EmptyState from './EmptyState.vue';
import { createApp, createFakeElement, find, textOf } from './fake-renderer';
import type { FakeElement } from './fake-renderer';

// Ф7-8: the empty state gained an optional `icon`. The default must stay the
// magnifier every search-driven screen already shows — the calendar is the only
// caller that overrides it — so both halves of that contract are pinned here.

let cleanups: Array<() => void> = [];

function mountState(props: { text: string; icon?: string }): FakeElement {
    const container = createFakeElement('#container');
    const app = createApp({
        // Same SFC-to-Component cast as in the other component tests.
        render: () => h(EmptyState as unknown as Component, props),
    });
    app.mount(container);
    cleanups.push(() => app.unmount());
    return container;
}

afterEach(() => {
    for (const cleanup of cleanups) {
        cleanup();
    }
    cleanups = [];
});

describe('EmptyState icon (Ф7-8)', () => {
    it('shows the magnifier when the caller passes no icon', () => {
        const container = mountState({ text: 'Ничего не найдено' });
        expect(textOf(find(container, 'empty__icon')).trim()).toBe('🔍');
        expect(textOf(find(container, 'empty__text')).trim()).toBe('Ничего не найдено');
    });

    it('shows the icon the caller passed instead', () => {
        const container = mountState({ text: 'Пусто', icon: '📅' });
        expect(textOf(find(container, 'empty__icon')).trim()).toBe('📅');
    });
});
