import { afterEach, describe, expect, it } from 'vitest';
import { h } from 'vue';
import type { Component } from 'vue';
import TabBar from './TabBar.vue';
import { i18n } from '@/src/lib/i18n';
import { POPUP_TABS } from '@/src/lib/storage';
import type { PopupTab } from '@/src/lib/storage';
import { clickOn, createApp, createFakeElement, findAll, textOf } from './fake-renderer';
import type { FakeElement } from './fake-renderer';

// Ф7-9: the tab bar carries three tabs. It renders exactly the storage
// vocabulary (POPUP_TABS), so a tab added to the persisted values cannot be
// missing from the bar; the geometry is untouched (the three Russian labels fit
// 380px per the measurement in the screens/calendar card).

interface Mounted {
    container: FakeElement;
    picked: PopupTab[];
}

let cleanups: Array<() => void> = [];

function mountBar(active: PopupTab): Mounted {
    const picked: PopupTab[] = [];
    const container = createFakeElement('#container');
    const app = createApp({
        render: () =>
            // Same SFC-to-Component cast as in the other component tests.
            h(TabBar as unknown as Component, {
                active,
                'onUpdate:active': (tab: PopupTab) => {
                    picked.push(tab);
                },
            }),
    });
    app.mount(container);
    cleanups.push(() => app.unmount());
    return { container, picked };
}

function tabs(container: FakeElement): FakeElement[] {
    return findAll(container, 'tabs__tab');
}

afterEach(() => {
    for (const cleanup of cleanups) {
        cleanup();
    }
    cleanups = [];
});

describe('TabBar (Ф7-9)', () => {
    it('renders one labelled tab per known popup tab', () => {
        const { container } = mountBar('search');
        expect(tabs(container)).toHaveLength(POPUP_TABS.length);
        expect(tabs(container).map((tab) => textOf(tab).trim())).toEqual([
            i18n.tabs.search,
            i18n.tabs.myLists,
            i18n.tabs.calendar,
        ]);
    });

    it('marks exactly the active tab', () => {
        const { container } = mountBar('calendar');
        expect(tabs(container).map((tab) => tab.props['aria-selected'])).toEqual([
            false,
            false,
            true,
        ]);
        expect(findAll(container, 'tabs__tab--active')).toHaveLength(1);
    });

    it('emits the picked tab and stays silent on the active one', () => {
        const { container, picked } = mountBar('search');
        clickOn(tabs(container)[2]!);
        clickOn(tabs(container)[1]!);
        clickOn(tabs(container)[0]!); // already active
        expect(picked).toEqual(['calendar', 'lists']);
    });
});
