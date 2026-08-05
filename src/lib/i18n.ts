import type { ApiError, RateTargetType, UserRateStatus } from './api/types';

// Book-variant (manga/ranobe) overrides; statuses missing here reuse the shared
// anime labels (docs/03 status table). Declared apart from the i18n literal so
// `satisfies` can check the keys against UserRateStatus while keeping the set
// partial: a typo would otherwise pass as an extra key and silently fall back
// to the anime wording.
const statusesBook = {
    watching: 'Читаю',
    rewatching: 'Перечитываю',
    completed: 'Прочитано',
} satisfies Partial<Record<UserRateStatus, string>>;

// Every UI string lives in this single object (docs/05-ui.md, principle 4).
// No i18n libraries: the extension is single-user and Russian-only.
export const i18n = {
    app: {
        name: 'ShikiFAV',
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
        // Opens the options page on its «Поддержать» section (Ф8-3).
        support: 'Поддержать проект',
    },
    tabs: {
        search: 'Поиск',
        myLists: 'Мои списки',
        calendar: 'Календарь',
    },
    search: {
        placeholder: 'Поиск',
        emptyHint: 'Введите название аниме, манги или ранобэ',
        noResults: 'Ничего не найдено',
        clear: 'Очистить',
        // aria-label of the chip row that picks what is being searched.
        typeFilterLabel: 'Тип поиска',
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
    // Ongoings calendar (phase 7): headers of the day groups. Every other day
    // header is a date formatted by Intl (`пн, 3 августа`), see
    // src/lib/calendar-schedule.ts.
    calendar: {
        today: 'Сегодня',
        tomorrow: 'Завтра',
        // Both a missing nextEpisodeAt (~8% of ongoings, docs/03) and a date the
        // server has not moved forward yet.
        undated: 'Дата не объявлена',
        // Next episode line, assembled in CalendarRow: «Серия 9 из 16»; with an
        // unknown total (One Piece) the «из N» half is simply dropped —
        // «Серия 1147».
        episodeWord: 'Серия',
        outOf: 'из',
        // Backlog line, «Смотрю»/«Пересматриваю» only: «вы на 5-й из 8 вышедших».
        // The ordinal ending fits any number, so no plural rules are needed.
        behindPrefix: 'вы на',
        behindOrdinal: '-й',
        behindSuffix: 'вышедших',
        // Zero progress: the general formula would read «вы на 0-й из 3 вышедших».
        behindNotStarted: 'вы ещё не начали',
        // Empty tab. Says out loud that the calendar is anime-only: manga and
        // ranobe have no next-chapter date in the API (docs/03), so their
        // absence here is by design, not a bug.
        empty:
            'Ни одно аниме из ваших списков сейчас не выходит. Календарь только про аниме: ' +
            'даты следующих глав манги и ранобэ Shikimori не сообщает.',
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
    statusesBook,
    actions: {
        // The one-click add button has no constant label: it is built as
        // '+ ' + statusLabel(quickStatus, media) (Ф6-20).
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
        // Ф7-16 inline progress editor. The name of the phrase button: its
        // visible text («5 / 11 эп.») does not work as an accessible name.
        editProgress: 'Изменить номер серии',
        editProgressChapter: 'Изменить номер главы',
        // aria-label of the field itself.
        progressLabel: 'Номер серии',
        progressLabelChapter: 'Номер главы',
        // title of the field: Enter is not visible anywhere else in the row.
        progressHint: 'Enter — сохранить, Esc — отменить',
        // Out-of-range tail: `${progressMaxPrefix} ${total}` replaces «/ N эп.».
        progressMaxPrefix: 'макс.',
        // Ф7-20: Shikimori moves a title to another status on its own once the
        // progress reaches the total, and an explicit status in the same PATCH
        // does not stop it (docs/03, owner-verified 2026-07-29). Without this
        // toast the row silently disappears from the «Смотрю» filter. The
        // placeholder is filled by autoStatusMessage(), never by hand.
        autoStatusToast: 'Shikimori перевёл тайтл в «{status}»',
    },
    // Context menu item for a text selection (US-8). %s is substituted by
    // Chrome with the selected text — never interpolate it by hand.
    contextMenu: {
        searchSelection: 'Найти «%s» на Shikimori',
    },
    // Options page (design card screens/options): four sections behind
    // vertical tabs — «Вид», «Поведение», «Аккаунт и данные», «Поддержать».
    options: {
        title: 'Настройки',

        // --- section tabs ---
        sectionsLabel: 'Разделы настроек',
        sectionView: 'Вид',
        sectionBehavior: 'Поведение',
        sectionAccount: 'Аккаунт и данные',
        // Narrow window: the tabs become a horizontal row and the long label
        // no longer fits.
        sectionAccountShort: 'Аккаунт',
        // Ф8: last, and not a setting at all — the ways to support the project.
        // The payment methods live in src/lib/donations.ts, next to the links
        // they carry; the rest of the section is spelled out below.
        sectionSupport: 'Поддержать',

        // --- «Вид» ---
        themeLabel: 'Тема',
        themeHint:
            'Системная — как в браузере и системе. Явный выбор действует только в расширении.',
        themeSystem: 'системная',
        themeLight: 'светлая',
        themeDark: 'тёмная',
        titleLangLabel: 'Названия',
        titleLangHint: 'Что показывать первой строкой в карточках поиска и списков.',
        titleLangRu: 'русские',
        titleLangRomaji: 'ромадзи',

        // --- «Поведение» ---
        startTabLabel: 'Стартовая вкладка',
        startTabHint: 'С какой вкладки открывается popup.',
        // The two other values reuse i18n.tabs (they name the same tabs).
        startTabLast: 'Последняя открытая',
        quickStatusLabel: 'Статус в один клик',
        quickStatusHint:
            'Какой статус ставит кнопка на карточке поиска. Для манги и ранобэ подпись меняется: «Читаю», «Прочитано».',
        defaultsLabel: 'Фильтры по умолчанию',
        defaultsHint: 'С какими фильтрами открываются вкладки, пока вы не переключили их сами.',
        defaultTypeLabel: 'Тип в поиске',
        defaultListStatusLabel: 'Статус в «Моих списках»',

        // --- «Аккаунт и данные» ---
        originLabel: 'Домен API',
        // Switching the domain drops the session on purpose (docs/03 «301 на
        // shikimori.one», docs/04) — the hint must say so before the click, and
        // that half of it is emphasized instead of muted (design card), hence
        // the two strings.
        originHint:
            'Рабочий домен — shikimori.io: shikimori.one отвечает редиректом на запрос токена.',
        originHintSession: 'Смена домена завершает сессию — потребуется войти заново.',
        dataLabel: 'Данные',
        dataHint:
            'Очистка сбрасывает кэш последнего поиска, списков и активной вкладки. Вход и настройки не затрагиваются.',
        clearCache: 'Очистить кэш',
        cacheCleared: 'Кэш очищен',
        logout: 'Выйти',
        version: 'Версия',

        // --- Анонимная статистика (Ф10-2) ---
        // Формулировка перечисляет и то, что отправляется, и то, что не
        // отправляется: настройка включена по умолчанию, поэтому человек читает
        // её уже постфактум и вправе увидеть точный список, а не «улучшаем
        // продукт». Список обязан совпадать с PRIVACY.md — расходиться им
        // нельзя, это обещание.
        analyticsLabel: 'Анонимная статистика',
        analyticsHint:
            'Помогает понять, какими функциями пользуются. Отправляются обезличенные события: какая вкладка открыта, что искали — аниме, мангу или ранобэ, — какие настройки меняли и какие ошибки случились. Ни аккаунт, ни списки, ни тексты запросов не передаются.',
        analyticsOn: 'Включена',
        analyticsOff: 'Выключена',

        // --- «Поддержать» (Ф8-2) ---
        // Two states, two intros. With at least one way to pay the section
        // invites one; with none it says outright that no money is asked —
        // an invitation without a single place to pay would be a promise
        // nobody can keep. The heading of the free block moves with it: «ещё»
        // only makes sense after a list of methods.
        supportLabel: 'Поддержать разработку',
        supportHint:
            'ShikiFAV бесплатен и без рекламы. Если он экономит вам время, разработку можно поддержать — это не обязательно.',
        supportEmptyLabel: 'Как помочь',
        supportEmptyHint:
            'ShikiFAV бесплатен и без рекламы. Денег он не просит — но помочь проекту всё равно можно.',
        helpLabel: 'Как ещё помочь',
        // Wording of the free ways to help; their ids and (optional) addresses
        // live in src/lib/donations.ts. The note follows the name after an em
        // dash, so it starts lowercase and carries no final period.
        helpReview: 'Отзыв в Chrome Web Store',
        helpReviewNote: 'оценка и пара слов помогают другим найти расширение',
        helpShare: 'Рассказать знакомым',
        helpShareNote: 'тем, кто ведёт списки на Shikimori',
        helpBug: 'Сообщить об ошибке',
        helpBugNote: 'опишите, что сломалось и на каком экране',
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
        // Widening assignment, not a cast: statusesBook is key-checked at its
        // declaration, and the partial view makes it indexable by a status it
        // does not override.
        const overrides: Partial<Record<UserRateStatus, string>> = statusesBook;
        const override = overrides[status];
        if (override !== undefined) {
            return override;
        }
    }
    return i18n.statuses[status];
}

// Ф7-20: the message about a status the server picked by itself. Built here,
// next to the template, so the placeholder token never leaks into the callers;
// the label follows the media — a manga reads «Прочитано», not «Просмотрено».
export function autoStatusMessage(status: UserRateStatus, media: MediaKind): string {
    return i18n.rates.autoStatusToast.replace('{status}', statusLabel(status, media));
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
