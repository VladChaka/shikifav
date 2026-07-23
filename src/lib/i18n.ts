import type { ApiError, UserRateStatus } from './api/types';

// Every UI string lives in this single object (docs/05-ui.md, principle 4).
// No i18n libraries: the extension is single-user and Russian-only.
export const i18n = {
    app: {
        name: 'ShikiFav',
    },
    login: {
        lead: 'Войдите, чтобы управлять своими списками',
        signIn: 'Войти через Shikimori',
        signingIn: 'Входим…',
        retry: 'Повторить',
    },
    header: {
        logout: 'Выйти',
        settings: 'Настройки',
    },
    tabs: {
        search: 'Поиск',
        myLists: 'Мои списки',
        inDevelopment: 'В разработке',
    },
    search: {
        placeholder: 'Название аниме…',
        emptyHint: 'Введите название аниме, манги или ранобэ',
        noResults: 'Ничего не найдено',
    },
    card: {
        episodesShort: 'эп.',
    },
    // AnimeKindEnum values (docs/03); unknown kinds fall back to the raw value.
    kinds: {
        tv: 'TV',
        movie: 'Фильм',
        ova: 'OVA',
        ona: 'ONA',
        special: 'Спешл',
        tv_special: 'TV-спешл',
        music: 'Клип',
        pv: 'PV',
        cm: 'CM',
    },
    // AnimeStatusEnum / MangaStatusEnum values (docs/03).
    titleStatuses: {
        anons: 'Анонс',
        ongoing: 'Онгоинг',
        released: 'Вышло',
        paused: 'Приостановлено',
        discontinued: 'Прекращено',
    },
    // Anime-variant labels (docs/03 status table); manga variants come in phase 4.
    // Keys = UserRateStatus values, exhaustiveness is checked by statusLabel below.
    statuses: {
        planned: 'Запланировано',
        watching: 'Смотрю',
        rewatching: 'Пересматриваю',
        completed: 'Просмотрено',
        on_hold: 'Отложено',
        dropped: 'Брошено',
    },
    actions: {
        addPlanned: '+ Запланировано',
        chooseStatus: 'Выбрать статус',
        removeFromList: 'Удалить из списка',
        retry: 'Повторить',
    },
    rates: {
        // 404 on update/delete: the record is gone on the site (Ф2-7).
        alreadyRemoved: 'Запись уже удалена',
    },
    errors: {
        network: 'Нет соединения с Shikimori. Проверьте интернет и повторите.',
        unauthorized: 'Сессия истекла. Войдите заново.',
        rateLimited: 'Слишком много запросов. Подождите немного и повторите.',
        api: 'Shikimori ответил ошибкой. Попробуйте ещё раз.',
        internal: 'Что-то пошло не так. Повторите попытку.',
        // Lazy detection of revoked write access (docs/05, решение 2026-07-23).
        editForbidden: 'Нет доступа на редактирование — войдите заново',
    },
} as const;

// Russian label of a user rate status (anime variant). Indexing i18n.statuses
// with the full UserRateStatus union makes the label set compile-checked:
// a status without a label fails here.
export function statusLabel(status: UserRateStatus): string {
    return i18n.statuses[status];
}

// Kind/status of a title come from GraphQL as plain strings (not unions),
// so these lookups fall back to the raw value for unmapped ones.
export function kindLabel(kind: string | null): string | null {
    if (!kind) {
        return null;
    }
    return (i18n.kinds as Record<string, string>)[kind] ?? kind;
}

export function titleStatusLabel(status: string | null): string | null {
    if (!status) {
        return null;
    }
    return (i18n.titleStatuses as Record<string, string>)[status] ?? status;
}

// Maps a transport-level ApiError to a human-readable Russian message.
// The switch is exhaustive: adding a new ApiError kind breaks compilation here.
export function apiErrorMessage(error: ApiError): string {
    switch (error.kind) {
        case 'network':
            return i18n.errors.network;
        case 'unauthorized':
            return i18n.errors.unauthorized;
        case 'rate_limited':
            return i18n.errors.rateLimited;
        case 'api':
            return i18n.errors.api;
        case 'internal':
            return i18n.errors.internal;
    }
}
