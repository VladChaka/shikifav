// TEMPORARY (Ф2-5): static fixtures and a demo state switcher for the search
// screen layout. DELETE THIS FILE in Ф2-6 when useSearch delivers real data,
// and remove its imports from App.vue.

import type { TitleCard } from '@/src/lib/api/types';

// Tiny inline-SVG posters: demonstrate the img+srcset path without network.
function stubPoster(fill: string): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="94"><rect width="60" height="94" fill="${fill}"/></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export const STUB_CARDS: TitleCard[] = [
    {
        // Not in my list: split "+ Запланировано ▾" button.
        id: '52991',
        name: 'Sousou no Frieren',
        russian: 'Фрирен, провожающая в последний путь',
        kind: 'tv',
        score: 9.11,
        status: 'released',
        episodes: 28,
        episodesAired: 28,
        year: 2023,
        posterUrl: stubPoster('#6d8aa8'),
        posterUrl2x: stubPoster('#6d8aa8'),
        userRate: null,
    },
    {
        // In my list (watching badge) + ongoing episodes "1122 / ? эп.".
        id: '21',
        name: 'One Piece',
        russian: 'Ван-Пис',
        kind: 'tv',
        score: 8.71,
        status: 'ongoing',
        episodes: 0,
        episodesAired: 1122,
        year: 1999,
        posterUrl: stubPoster('#a8886d'),
        posterUrl2x: stubPoster('#a8886d'),
        userRate: { id: '101', status: 'watching' },
    },
    {
        // russian = null (name fallback, single title row) + inline warning.
        id: '58514',
        name: 'Look Back',
        russian: null,
        kind: 'movie',
        score: 8.9,
        status: 'released',
        episodes: 1,
        episodesAired: 1,
        year: 2024,
        posterUrl: stubPoster('#6da88a'),
        posterUrl2x: stubPoster('#6da88a'),
        userRate: { id: '102', status: 'completed' },
    },
    {
        // posterUrl = null (placeholder box), announcement without score/year.
        id: '99999',
        name: 'Chainsaw Man Movie: Reze-hen',
        russian: 'Человек-бензопила: История Резе',
        kind: 'movie',
        score: null,
        status: 'anons',
        episodes: 0,
        episodesAired: 0,
        year: null,
        posterUrl: null,
        posterUrl2x: null,
        userRate: null,
    },
    {
        // busy = true: all actions locked while a write is in flight.
        id: '9253',
        name: 'Steins;Gate',
        russian: 'Врата Штейна',
        kind: 'tv',
        score: 9.07,
        status: 'released',
        episodes: 24,
        episodesAired: 24,
        year: 2011,
        posterUrl: stubPoster('#8a6da8'),
        posterUrl2x: stubPoster('#8a6da8'),
        userRate: { id: '103', status: 'planned' },
    },
    {
        // Bottom-of-list card: its StatusMenu should open upwards.
        id: '39535',
        name: 'Mushoku Tensei: Isekai Ittara Honki Dasu',
        russian: 'Реинкарнация безработного: История о приключениях в другом мире',
        kind: 'tv',
        score: 8.35,
        status: 'released',
        episodes: 11,
        episodesAired: 11,
        year: 2021,
        posterUrl: stubPoster('#a86d78'),
        posterUrl2x: stubPoster('#a86d78'),
        userRate: { id: '104', status: 'on_hold' },
    },
];

export const STUB_BUSY_ID = '9253';
export const STUB_WARNING_ID = '58514';

// Dev-only switcher between screen states (visual check of Ф2-5 layout).
export type DemoView = 'results' | 'loading' | 'empty-hint' | 'no-results' | 'error';

export const DEMO_VIEWS: readonly { id: DemoView; label: string }[] = [
    { id: 'results', label: 'данные' },
    { id: 'loading', label: 'загрузка' },
    { id: 'empty-hint', label: 'пусто' },
    { id: 'no-results', label: 'не найдено' },
    { id: 'error', label: 'ошибка' },
];

export const DEMO_TOAST_LABEL = 'тост';
