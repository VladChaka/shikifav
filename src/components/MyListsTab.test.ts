import { afterEach, describe, expect, it } from 'vitest';
import { h } from 'vue';
import type { Component } from 'vue';
import MyListsTab from './MyListsTab.vue';
import type { SearchType, UserRateStatus } from '@/src/lib/api/types';
import { i18n } from '@/src/lib/i18n';
import { clickOn, createApp, createFakeElement, findAll, textOf } from './fake-renderer';
import type { FakeElement } from './fake-renderer';

// UX-1: both filters are ChipGroup rows — neutral chips for the type and six
// status chips — instead of selects. Only what MyListsTab adds on top of the
// shared control is asserted here (the two groups, their order and labels);
// the chip contract itself lives in ChipGroup.test.ts. Mounted through the
// shared fake renderer, with the list body kept in the 'empty' state so no
// RateRow subtree renders.

interface MountProps {
    filterType: SearchType;
    filterStatus: UserRateStatus;
}

interface Mounted {
    container: FakeElement;
    emittedTypes: SearchType[];
    emittedStatuses: UserRateStatus[];
}

let cleanups: Array<() => void> = [];

function mountTab(props: MountProps): Mounted {
    const emittedTypes: SearchType[] = [];
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
                'onUpdate:filterType': (value: SearchType) => {
                    emittedTypes.push(value);
                },
                'onUpdate:filterStatus': (value: UserRateStatus) => {
                    emittedStatuses.push(value);
                },
            }),
    });
    app.mount(container);
    cleanups.push(() => app.unmount());
    return { container, emittedTypes, emittedStatuses };
}

// Filters, in template order: the type row first, the status row below it.
function typeGroup(container: FakeElement): FakeElement {
    return findAll(container, 'chips')[0]!;
}

function statusGroup(container: FakeElement): FakeElement {
    return findAll(container, 'chips')[1]!;
}

function chips(group: FakeElement): FakeElement[] {
    return findAll(group, 'chip');
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

describe('MyListsTab filters (UX-1)', () => {
    it('renders exactly two chip rows and no select', () => {
        const { container } = mountTab({ filterType: 'anime', filterStatus: 'watching' });
        const groups = findAll(container, 'chips');
        expect(groups.map((group) => group.props['aria-label'])).toEqual([
            i18n.lists.typeFilterLabel,
            i18n.lists.statusFilterLabel,
        ]);
        expect(findAll(container, 'xselect')).toHaveLength(0);
    });

    it('renders the three types, checking the selected one', () => {
        const { container } = mountTab({ filterType: 'manga', filterStatus: 'watching' });
        const all = chips(typeGroup(container));
        expect(all.map((chip) => textOf(chip).trim())).toEqual(['Аниме', 'Манга', 'Ранобэ']);
        expect(all.map((chip) => chip.props['aria-checked'])).toEqual([false, true, false]);
    });

    it('emits update:filterType with the value of the clicked type chip', () => {
        const { container, emittedTypes } = mountTab({
            filterType: 'anime',
            filterStatus: 'watching',
        });
        // Two different inactive chips: a mutation that emits any constant
        // cannot satisfy both expected values.
        clickOn(chips(typeGroup(container))[1]!);
        clickOn(chips(typeGroup(container))[2]!);
        expect(emittedTypes).toEqual(['manga', 'ranobe']);
    });

    it('renders six status chips in the US-3 order, tagged with st-* classes', () => {
        const { container } = mountTab({ filterType: 'anime', filterStatus: 'watching' });
        const statusClasses = chips(statusGroup(container)).map((chip) =>
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

    it('labels the status chips with the anime wording for the anime filter', () => {
        const { container } = mountTab({ filterType: 'anime', filterStatus: 'watching' });
        expect(chips(statusGroup(container)).map((chip) => textOf(chip).trim())).toEqual([
            'Запланировано',
            'Смотрю',
            'Пересматриваю',
            'Просмотрено',
            'Отложено',
            'Брошено',
        ]);
    });

    it.each<SearchType>(['manga', 'ranobe'])(
        'labels the status chips with the book wording for the %s filter',
        (filterType) => {
            const { container } = mountTab({ filterType, filterStatus: 'watching' });
            expect(chips(statusGroup(container)).map((chip) => textOf(chip).trim())).toEqual([
                'Запланировано',
                'Читаю',
                'Перечитываю',
                'Прочитано',
                'Отложено',
                'Брошено',
            ]);
        },
    );

    it('checks exactly the active status chip', () => {
        const { container } = mountTab({ filterType: 'anime', filterStatus: 'completed' });
        expect(chips(statusGroup(container)).map((chip) => chip.props['aria-checked'])).toEqual([
            false,
            false,
            false,
            true,
            false,
            false,
        ]);
    });

    it('emits update:filterStatus with the value of the clicked status chip', () => {
        const { container, emittedStatuses } = mountTab({
            filterType: 'anime',
            filterStatus: 'watching',
        });
        clickOn(chips(statusGroup(container))[3]!); // completed
        clickOn(chips(statusGroup(container))[5]!); // dropped
        expect(emittedStatuses).toEqual(['completed', 'dropped']);
    });
});
