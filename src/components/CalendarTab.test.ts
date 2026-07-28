import { afterEach, describe, expect, it } from 'vitest';
import { h } from 'vue';
import type { Component } from 'vue';
import CalendarTab from './CalendarTab.vue';
import type { CalendarItem } from '@/src/lib/api/types';
import { buildSchedule, UNDATED_DAY_KEY } from '@/src/lib/calendar-schedule';
import type { ScheduleDay } from '@/src/lib/calendar-schedule';
import { i18n } from '@/src/lib/i18n';
import { clickOn, createApp, createFakeElement, find, findAll, textOf } from './fake-renderer';
import type { FakeElement } from './fake-renderer';

// Ф7-8: the calendar tab frame (screens/calendar card) — day groups plus the
// four data states, everything else delegated to CalendarRow and to the shared
// state components. Groups come from the real schedule layer against a fixed
// clock. Mounted through the shared fake renderer.

// 2026-07-28 12:00 local — the reference "now" of every case below.
const NOW = new Date(2026, 6, 28, 12, 0);

function item(id: string, overrides: Partial<CalendarItem> = {}): CalendarItem {
    return {
        rateId: id,
        targetId: `10${id}`,
        name: `Title ${id}`,
        russian: null,
        status: 'watching',
        posterUrl: null,
        posterUrl2x: null,
        nextEpisodeAt: null,
        episodes: 12,
        episodesAired: 3,
        progress: 3,
        url: null,
        ...overrides,
    };
}

function at(day: number, hour: number, minute: number): string {
    return new Date(2026, 6, day, hour, minute).toISOString();
}

interface Mounted {
    container: FakeElement;
    retries: number;
}

let cleanups: Array<() => void> = [];

function mountTab(props: {
    days?: ScheduleDay<CalendarItem>[];
    screenStatus: 'skeleton' | 'data' | 'empty' | 'error';
    errorText?: string;
}): Mounted {
    const state = { retries: 0 };
    const container = createFakeElement('#container');
    const app = createApp({
        render: () =>
            // Same SFC-to-Component cast as in the other component tests;
            // runtime props are the exact CalendarTab contract.
            h(CalendarTab as unknown as Component, {
                days: [],
                ...props,
                onRetry: () => {
                    state.retries += 1;
                },
            }),
    });
    app.mount(container);
    cleanups.push(() => app.unmount());
    return {
        container,
        get retries(): number {
            return state.retries;
        },
    };
}

function dayTitles(container: FakeElement): string[] {
    return findAll(container, 'calendar__day-title').map((el) => textOf(el).trim());
}

afterEach(() => {
    for (const cleanup of cleanups) {
        cleanup();
    }
    cleanups = [];
});

describe('CalendarTab states (Ф7-8)', () => {
    it('renders the skeleton while the first load runs', () => {
        const { container } = mountTab({ screenStatus: 'skeleton' });
        expect(findAll(container, 'skeleton__row').length).toBeGreaterThan(0);
        expect(findAll(container, 'cal')).toHaveLength(0);
        // Day headers arrive with the data, never with the placeholder.
        expect(dayTitles(container)).toEqual([]);
    });

    it('renders the calendar empty state with the 📅 icon, not the magnifier', () => {
        const { container } = mountTab({ screenStatus: 'empty' });
        expect(textOf(find(container, 'empty__text')).trim()).toBe(i18n.calendar.empty);
        expect(textOf(find(container, 'empty__icon')).trim()).toBe('📅');
    });

    it('renders the error text with a retry that reaches the owner', () => {
        const mounted = mountTab({ screenStatus: 'error', errorText: i18n.errors.network });
        expect(textOf(find(mounted.container, 'error__text')).trim()).toBe(i18n.errors.network);
        clickOn(find(mounted.container, 'error__retry'));
        expect(mounted.retries).toBe(1);
    });

    it('falls back to a generic message when the error carries no text', () => {
        const { container } = mountTab({ screenStatus: 'error' });
        expect(textOf(find(container, 'error__text')).trim()).toBe(i18n.errors.internal);
    });

    it('renders one titled group per day, undated last', () => {
        const days = buildSchedule(
            [
                item('1', { nextEpisodeAt: at(28, 16, 0) }),
                item('2', { nextEpisodeAt: at(29, 17, 15) }),
                item('3', { nextEpisodeAt: at(31, 12, 30) }),
                item('4', { nextEpisodeAt: null }),
            ],
            NOW,
        );
        const { container } = mountTab({ days, screenStatus: 'data' });

        expect(dayTitles(container)).toEqual([
            i18n.calendar.today,
            i18n.calendar.tomorrow,
            'пт, 31 июля',
            i18n.calendar.undated,
        ]);
        // The undated group is a group like any other: same header element, no
        // special styling hook.
        expect(days[days.length - 1]?.key).toBe(UNDATED_DAY_KEY);
        expect(findAll(container, 'calendar__day')).toHaveLength(4);
        expect(findAll(container, 'cal')).toHaveLength(4);
    });

    it('keeps the rows of a day inside their own group', () => {
        const days = buildSchedule(
            [
                item('1', { nextEpisodeAt: at(28, 18, 35) }),
                item('2', { nextEpisodeAt: at(28, 9, 5) }),
                item('3', { nextEpisodeAt: null }),
            ],
            NOW,
        );
        const { container } = mountTab({ days, screenStatus: 'data' });

        const groups = findAll(container, 'calendar__day');
        expect(groups).toHaveLength(2);
        // Ordered by air time inside the day (the schedule layer's job, visible
        // here as the rendered order).
        expect(findAll(groups[0]!, 'cal__time').map((el) => textOf(el).trim())).toEqual([
            '09:05',
            '18:35',
        ]);
        expect(findAll(groups[1]!, 'cal')).toHaveLength(1);
    });

    it('renders no type chip row: the calendar is anime-only', () => {
        const days = buildSchedule([item('1', { nextEpisodeAt: at(28, 16, 0) })], NOW);
        const { container } = mountTab({ days, screenStatus: 'data' });
        expect(findAll(container, 'chips')).toHaveLength(0);
        expect(findAll(container, 'chip')).toHaveLength(0);
    });
});
