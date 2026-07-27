import type { ApiError, RateTargetType, UserRateStatus } from './api/types';

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
    },
    search: {
        placeholder: 'Поиск',
        emptyHint: 'Введите название аниме, манги или ранобэ',
        noResults: 'Ничего не найдено',
    },
    // "Мои списки" tab: type/status filters, pagination, empty state (docs/05).
    lists: {
        typeFilterLabel: 'Тип',
        statusFilterLabel: 'Статус',
        types: {
            anime: 'Аниме',
            manga: 'Манга',
            ranobe: 'Ранобэ',
        },
        loadMore: 'Ещё',
        loadingMore: 'Загрузка…',
        empty: 'Ничего не найдено',
    },
    // Score picker (US-5): 0 removes the score, 1–10 set it.
    score: {
        label: 'Оценка',
        remove: 'Снять оценку',
    },
    common: {
        yes: 'Да',
        later: 'Позже',
    },
    card: {
        episodesShort: 'эп.',
        chaptersShort: 'гл.',
        volumesShort: 'т.',
    },
    // AnimeKindEnum / MangaKindEnum values (docs/03); unknown kinds fall back
    // to the raw value.
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
        manga: 'Манга',
        manhwa: 'Манхва',
        manhua: 'Маньхуа',
        light_novel: 'Ранобэ',
        novel: 'Новелла',
        one_shot: 'Ваншот',
        doujin: 'Додзинси',
    },
    // AnimeStatusEnum / MangaStatusEnum values (docs/03).
    titleStatuses: {
        anons: 'Анонс',
        ongoing: 'Онгоинг',
        released: 'Вышло',
        paused: 'Приостановлено',
        discontinued: 'Прекращено',
    },
    // Anime-variant labels (docs/03 status table).
    // Keys = UserRateStatus values, exhaustiveness is checked by statusLabel below.
    statuses: {
        planned: 'Запланировано',
        watching: 'Смотрю',
        rewatching: 'Пересматриваю',
        completed: 'Просмотрено',
        on_hold: 'Отложено',
        dropped: 'Брошено',
    },
    // Book-variant (manga/ranobe) overrides; statuses missing here reuse the
    // shared labels above (docs/03 status table).
    statusesBook: {
        watching: 'Читаю',
        rewatching: 'Перечитываю',
        completed: 'Прочитано',
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
        // aria/title of the "+1 episode" button in a list row (US-6).
        increment: '+1 эпизод',
        // Book-variant of the increment button (phase 4).
        incrementChapter: '+1 глава',
        // Inline suggestion after progress reaches the total (US-6, not automatic).
        markCompletedQuestion: 'Перевести в «Просмотрено»?',
        // Book-variant of the completion suggestion (phase 4).
        markReadQuestion: 'Перевести в «Прочитано»?',
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

// UI wording variant: anime uses "смотрю/просмотрено", books (manga/ranobe)
// use "читаю/прочитано".
export type MediaKind = 'anime' | 'book';

// GraphQL/REST expose the list target as 'Anime' | 'Manga'; ranobe is a Manga
// subtype, so both map to the book wording.
export function mediaOf(targetType: RateTargetType): MediaKind {
    return targetType === 'Anime' ? 'anime' : 'book';
}

// Russian label of a user rate status. Indexing i18n.statuses with the full
// UserRateStatus union makes the label set compile-checked: a status without
// a label fails here. Book overrides are partial and fall back to the shared
// labels.
export function statusLabel(status: UserRateStatus, media: MediaKind = 'anime'): string {
    if (media === 'book') {
        const override = (i18n.statusesBook as Partial<Record<UserRateStatus, string>>)[status];
        if (override !== undefined) {
            return override;
        }
    }
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
