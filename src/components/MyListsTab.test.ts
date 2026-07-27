import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h } from 'vue';
import type { Component } from 'vue';
import MyListsTab from './MyListsTab.vue';
import type { SearchType, UserRateStatus } from '@/src/lib/api/types';
import { i18n } from '@/src/lib/i18n';
import { clickOn, createApp, createFakeElement, findAll, textOf } from './fake-renderer';
import type { FakeElement } from './fake-renderer';

// UX-1: the status filter is a row of six pill chips (role=radiogroup/radio)
// instead of a second XSelect. Mounted through the shared fake renderer; the
// list body is kept in the 'empty' state so no RateRow subtree renders.

interface MountProps {
    filterType: SearchType;
    filterStatus: UserRateStatus;
}

interface Mounted {
    container: FakeElement;
    emittedStatuses: UserRateStatus[];
}

let cleanups: Array<() => void> = [];

function mountTab(props: MountProps): Mounted {
    const emittedStatuses: UserRateStatus[] = [];
    const container = createFakeElement('#container');
    const app = createApp({
        render: () =>
            // The typed SFC constructor is not directly assignable to
            // Component (same cast as in XSelect.test.ts); runtime props are
            // the exact MyListsTab contract.
            h(MyListsTab as unknown as Component, {
                items: [],
                listStatus: 'empty',
                hasMore: false,
                loadingMore: false,
                ...props,
                'onUpdate:filterStatus': (value: UserRateStatus) => {
                    emittedStatuses.push(value);
                },
            }),
    });
    app.mount(container);
    cleanups.push(() => app.unmount());
    return { container, emittedStatuses };
}

function chips(container: FakeElement): FakeElement[] {
    return findAll(container, 'lists__chip');
}

function classesOf(el: FakeElement): string[] {
    return typeof el.props.class === 'string' ? el.props.class.split(/\s+/) : [];
}

beforeEach(() => {
    // No DOM in this environment; the closed type-filter XSelect and its
    // unmount hooks only need the listener API surface of document.
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

describe('MyListsTab status chips (UX-1)', () => {
    it('renders six chips in the US-3 status order, tagged with st-* classes', () => {
        const { container } = mountTab({ filterType: 'anime', filterStatus: 'watching' });
        const statusClasses = chips(container).map((chip) =>
            classesOf(chip).find((cls) => cls.startsWith('st-')),
        );
        expect(statusClasses).toEqual([
            'st-planned',
            'st-watching',
            'st-rewatching',
            'st-completed',
            'st-on_hold',
            'st-dropped',
        ]);
    });

    it('labels the chips with the anime wording for the anime filter', () => {
        const { container } = mountTab({ filterType: 'anime', filterStatus: 'watching' });
        expect(chips(container).map((chip) => textOf(chip).trim())).toEqual([
            'Запланировано',
            'Смотрю',
            'Пересматриваю',
            'Просмотрено',
            'Отложено',
            'Брошено',
        ]);
    });

    it.each<SearchType>(['manga', 'ranobe'])(
        'labels the chips with the book wording for the %s filter',
        (filterType) => {
            const { container } = mountTab({ filterType, filterStatus: 'watching' });
            expect(chips(container).map((chip) => textOf(chip).trim())).toEqual([
                'Запланировано',
                'Читаю',
                'Перечитываю',
                'Прочитано',
                'Отложено',
                'Брошено',
            ]);
        },
    );

    it('checks exactly the active chip (aria-checked) inside a labelled radiogroup', () => {
        const { container } = mountTab({ filterType: 'anime', filterStatus: 'completed' });

        const [group] = findAll(container, 'lists__chips');
        expect(group?.props.role).toBe('radiogroup');
        expect(group?.props['aria-label']).toBe(i18n.lists.statusFilterLabel);

        const all = chips(container);
        expect(all.map((chip) => chip.props.role)).toEqual(Array<string>(6).fill('radio'));
        expect(all.map((chip) => chip.props['aria-checked'])).toEqual([
            false,
            false,
            false,
            true,
            false,
            false,
        ]);
        expect(all.map((chip) => classesOf(chip).includes('lists__chip--active'))).toEqual([
            false,
            false,
            false,
            true,
            false,
            false,
        ]);
    });

    it('emits update:filterStatus with the value of the clicked chip', () => {
        const { container, emittedStatuses } = mountTab({
            filterType: 'anime',
            filterStatus: 'watching',
        });
        // Two different inactive chips: a mutation that emits any constant
        // cannot satisfy both expected values.
        clickOn(chips(container)[3]!); // completed
        clickOn(chips(container)[5]!); // dropped
        expect(emittedStatuses).toEqual(['completed', 'dropped']);
    });

    it('renders no status XSelect — the type select is the only one left', () => {
        const { container } = mountTab({ filterType: 'anime', filterStatus: 'watching' });
        const triggers = findAll(container, 'xselect');
        expect(triggers).toHaveLength(1);
        expect(triggers[0]!.props['aria-label']).toBe(i18n.lists.typeFilterLabel);
    });
});
