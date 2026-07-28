import { afterEach, describe, expect, it } from 'vitest';
import { h } from 'vue';
import type { Component } from 'vue';
import CalendarRowView from './CalendarRow.vue';
import type { CalendarItem, UserRateStatus } from '@/src/lib/api/types';
import { buildSchedule } from '@/src/lib/calendar-schedule';
import type { ScheduleEntry } from '@/src/lib/calendar-schedule';
import { i18n } from '@/src/lib/i18n';
import { createApp, createFakeElement, find, findAll, textOf } from './fake-renderer';
import type { FakeElement } from './fake-renderer';

// Ф7-8: one calendar row (screens/calendar card) — title link, air time,
// «Серия N из M», the backlog line and the read-only status badge. The entry is
// built by the real schedule layer against a fixed clock, so the numbers under
// test are the ones the tab will actually show. Mounted through the shared fake
// renderer.

const TITLE_URL = 'https://shikimori.io/animes/52991-sousou-no-frieren';

// 2026-07-28 12:00 local — the reference "now" of every case below.
const NOW = new Date(2026, 6, 28, 12, 0);

function item(overrides: Partial<CalendarItem> = {}): CalendarItem {
    return {
        rateId: '311',
        targetId: '52991',
        name: 'Sousou no Frieren',
        russian: 'Провожающая в последний путь Фрирен',
        status: 'watching',
        posterUrl: 'https://desu.shikimori.one/uploads/poster/animes/52991/mini.webp',
        posterUrl2x: 'https://desu.shikimori.one/uploads/poster/animes/52991/mini@2x.webp',
        // Today, 16:00 local.
        nextEpisodeAt: new Date(2026, 6, 28, 16, 0).toISOString(),
        episodes: 16,
        episodesAired: 8,
        progress: 5,
        url: TITLE_URL,
        ...overrides,
    };
}

// The row prop is a schedule entry, so it comes from buildSchedule — the same
// function use-calendar feeds the tab with.
function entryOf(data: CalendarItem): ScheduleEntry<CalendarItem> {
    const [day] = buildSchedule([data], NOW);
    if (!day?.entries[0]) {
        throw new Error('buildSchedule produced no entry');
    }
    return day.entries[0];
}

let cleanups: Array<() => void> = [];

function mountRow(data: CalendarItem): FakeElement {
    const container = createFakeElement('#container');
    const app = createApp({
        // Same SFC-to-Component cast as in the other component tests; runtime
        // props are the exact CalendarRow contract.
        render: () => h(CalendarRowView as unknown as Component, { entry: entryOf(data) }),
    });
    app.mount(container);
    cleanups.push(() => app.unmount());
    return container;
}

function episodeText(container: FakeElement): string {
    return textOf(find(container, 'cal__episode')).trim();
}

function behindText(container: FakeElement): string {
    return textOf(find(container, 'cal__behind')).trim();
}

afterEach(() => {
    for (const cleanup of cleanups) {
        cleanup();
    }
    cleanups = [];
});

describe('CalendarRow (Ф7-8)', () => {
    it('renders the next episode number with the known total', () => {
        expect(episodeText(mountRow(item()))).toBe('Серия 9 из 16');
    });

    it('drops «из N» when the total is unknown (long-runners)', () => {
        // One Piece: the API reports 0 total episodes.
        const container = mountRow(item({ episodes: 0, episodesAired: 1146, progress: 1128 }));
        expect(episodeText(container)).toBe('Серия 1147');
        expect(episodeText(container)).not.toContain(i18n.calendar.outOf);
    });

    it('shows the backlog line for «Смотрю» with the watched and aired counts', () => {
        expect(behindText(mountRow(item()))).toBe('вы на 5-й из 8 вышедших');
    });

    it('shows the backlog line for «Пересматриваю» too', () => {
        expect(behindText(mountRow(item({ status: 'rewatching' })))).toBe(
            'вы на 5-й из 8 вышедших',
        );
    });

    it('replaces the formula with «вы ещё не начали» at zero progress', () => {
        expect(behindText(mountRow(item({ progress: 0 })))).toBe(i18n.calendar.behindNotStarted);
    });

    it('renders no backlog line for «Запланировано», however far behind', () => {
        // Same numbers as the watching case, which does show the line.
        const container = mountRow(item({ status: 'planned' }));
        expect(findAll(container, 'cal__behind')).toHaveLength(0);
    });

    it('renders no backlog line when everything aired has been watched', () => {
        const container = mountRow(item({ progress: 8 }));
        expect(findAll(container, 'cal__behind')).toHaveLength(0);
    });

    it.each<[UserRateStatus, string]>([
        ['watching', 'Смотрю'],
        ['rewatching', 'Пересматриваю'],
        ['planned', 'Запланировано'],
    ])('renders the %s badge as a plain span with its palette class', (status, label) => {
        const badge = find(mountRow(item({ status })), 'cal__badge');
        // Read-only tab: a <span>, not a <button> — no status menu, no caret.
        expect(badge.tag).toBe('span');
        expect(textOf(badge).trim()).toBe(label);
        expect(String(badge.props.class).split(/\s+/)).toContain(`st-${status}`);
        expect(textOf(badge)).not.toContain('▾');
        expect(badge.listeners.click).toBeUndefined();
    });

    it('renders the local air time as a <time> carrying the raw instant', () => {
        const data = item();
        const time = find(mountRow(data), 'cal__time');
        expect(time.tag).toBe('time');
        expect(textOf(time).trim()).toBe('16:00');
        expect(time.props.datetime).toBe(data.nextEpisodeAt);
    });

    it('renders no time in the undated group', () => {
        expect(findAll(mountRow(item({ nextEpisodeAt: null })), 'cal__time')).toHaveLength(0);
    });

    it('renders the name as a new-tab link and repeats it on the poster', () => {
        const container = mountRow(item());
        const link = find(container, 'cal__title-link');
        expect(link.tag).toBe('a');
        expect(link.props.href).toBe(TITLE_URL);
        expect(link.props.target).toBe('_blank');
        expect(link.props.rel).toBe('noopener noreferrer');
        expect(textOf(link).trim()).toBe('Провожающая в последний путь Фрирен');

        const box = find(container, 'cal__poster-box');
        expect(box.tag).toBe('a');
        expect(box.props.href).toBe(TITLE_URL);
        // The poster duplicates the destination: out of the tab order and the
        // a11y tree.
        expect(box.props.tabindex).toBe('-1');
        expect(box.props['aria-hidden']).toBe('true');
    });

    it('renders a row without a usable url as plain text', () => {
        for (const url of ['javascript:alert(1)', 'http://shikimori.io/animes/52991', null]) {
            const container = mountRow(item({ url }));
            expect(find(container, 'cal__poster-box').tag).toBe('div');
            expect(findAll(container, 'cal__title-link')).toHaveLength(0);
            expect(textOf(find(container, 'cal__title')).trim()).toBe(
                'Провожающая в последний путь Фрирен',
            );
        }
    });

    it('falls back to the local image when the row has no poster', () => {
        const poster = find(mountRow(item({ posterUrl: null, posterUrl2x: null })), 'cal__poster');
        expect(String(poster.props.src)).toContain('poster-fallback');
        expect(poster.props.srcset).toBeUndefined();
        // Unchanged 42x58 box.
        expect(poster.props.width).toBe('42');
        expect(poster.props.height).toBe('58');
    });

    it('pairs a poster with its retina twin and skips a backfilled single', () => {
        const data = item();
        expect(find(mountRow(data), 'cal__poster').props.srcset).toBe(
            `${data.posterUrl} 1x, ${data.posterUrl2x} 2x`,
        );

        const backfilled = 'https://shikimori.io/system/animes/x96/1342.jpg?1711979744';
        const single = find(
            mountRow(item({ posterUrl: backfilled, posterUrl2x: null })),
            'cal__poster',
        );
        expect(single.props.src).toBe(backfilled);
        expect(single.props.srcset).toBeUndefined();
    });
});
