import type {
    ApiError,
    RateTargetType,
    RelatedItem,
    RelationKind,
    UserRateStatus,
} from './api/types';

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

// Heading of one relation group. Almost every kind reads the same whichever
// medium its rows are; `adaptation` is the exception and carries both wordings —
// which of them is shown is decided by relationGroupLabel().
type RelationGroupLabel = string | { source: string; screen: string };

// Ф12: group headings of the related screen, in the order the screen renders the
// groups (RELATION_KIND_RANK, src/lib/related.ts) — a map that reads top-down in
// the reading order of the screen is what makes it checkable against the design
// card at a glance. Declared apart from the i18n literal for the same reason as
// statusesBook: `satisfies Record<RelationKind, …>` turns a relation kind added
// to the union into a compile error here, instead of a group rendered with an
// empty heading. The wording is ours and deliberately differs from the server's
// relationText, which stays in the row meta (docs/03: anime and manga word the
// same kind differently).
const relationKinds = {
    sequel: 'Продолжение',
    prequel: 'Предыстория',
    full_story: 'Полная история',
    parent_story: 'Основная история',
    // The one kind that carries no direction: for an anime the adaptation link
    // points at the book it was made from, for a book at the anime made of it.
    adaptation: { source: 'Первоисточник', screen: 'Экранизации' },
    side_story: 'Побочные истории',
    spin_off: 'Ответвления',
    alternative_version: 'Другие версии',
    alternative_setting: 'Другая вселенная',
    summary: 'Пересказы',
    character: 'Общие персонажи',
    other: 'Прочее',
} satisfies Record<RelationKind, RelationGroupLabel>;

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
    // Related titles (US-11, phase 12): an overlay inside the popup, not a tab —
    // hence its own return bar with `title` on it and `back` on the arrow.
    //
    // Two approved entry points (owner, 2026-08-10) mean three labels for one
    // navigation, and they are not interchangeable: `open` is the accessible
    // name of BOTH controls and at the same time the visible text of the
    // StatusMenu item — one value in three places has nothing to drift from —
    // while `openLabel` and `openLabelShort` are what the eye reads in a search
    // card and in a list row, where the control is subtracted from the width of
    // the title itself and a shorter word buys back a whole line of the name
    // (design cards components/title-card, components/rate-row).
    related: {
        title: 'Связанные',
        back: 'Назад',
        open: 'Связанные тайтлы',
        openLabel: 'Связанные',
        openLabelShort: 'Связи',
        // An empty answer is a legal one, not a failure: standalone films really
        // have no links at all (the smoke list names «Унесённые призраками» and
        // «Могила светлячков»). The text names what is missing, because a bare
        // «Ничего не найдено» would read as a half-loaded screen.
        empty:
            'У этого тайтла нет связанных релизов: ни продолжений, ни первоисточника, ни ответвлений. ' +
            'Для самостоятельных фильмов и сериалов это обычное дело.',
        loadMore: 'Показать ещё',
        // The counter above «Показать ещё». Placeholders are filled by
        // shownOfMessage(), never by hand.
        shownOf: 'Показано {n} из {total}',
        kinds: relationKinds,
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
    // Ф11-9: the icon itself. `title` is the tooltip of the extension button and
    // replaces the plain «ShikiFAV» Chrome shows by default — hence the name is
    // part of both strings, otherwise the tooltip would lose it. The number is
    // the real one even when the badge shows «99+»: the tooltip is the place
    // where the capped counter can be read exactly. Placeholders are filled by
    // badgeTitleMessage(), never by hand.
    badge: {
        idleTitle: 'ShikiFAV',
        behindTitle: 'ShikiFAV: {n} {titles} с неотмеченными сериями',
        // Russian plural of «тайтл»; the form is picked by Intl.PluralRules.
        titleWords: { one: 'тайтл', few: 'тайтла', many: 'тайтлов' },
    },
    // Ф11-10: the system notification about an episode that came out. The title
    // of a notification is what the system TRUNCATES and what is recognised by
    // its first characters, so the name of the anime goes there and the episode
    // number into the message — the number must survive to the screen whole.
    // Both strings are filled by airedEpisodesMessage(), never by hand.
    notifications: {
        airedOne: 'Вышла {n} серия',
        // A short dash, and «серии» BEFORE the range: «Вышли 2–3 серии» reads as
        // «вышло две-три серии», i.e. as an estimate instead of a fact.
        airedRange: 'Вышли серии {first}–{last}',
        // There is no summary string for what a tick shows past its cap: the
        // rest of the increases move the snapshot silently and are counted by
        // the badge instead (owner's decision 2026-08-17, docs/06).
        //
        // The name arrives from the API and is stripped of control characters
        // before it is shown (src/lib/episode-notifications.ts); a name that was
        // nothing but those is left with no text at all.
        untitled: 'Тайтл без названия',
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

        // --- «Новые серии» (Ф11-11, US-12) ---
        // Последний блок «Поведения»: два подчинённых ряда чипов. Подсказка
        // называет и период опроса, и три статуса, и границу anime-only —
        // функция работает без пользователя, поэтому она обязана сказать о
        // себе всё до первого фонового запроса.
        episodesLabel: 'Новые серии',
        episodesHint:
            'Расширение раз в полчаса проверяет, не вышли ли новые серии у тайтлов из «Смотрю», «Пересматриваю» и «Запланировано». Число на иконке — сколько тайтлов ждут отметки. Только аниме: у манги и ранобэ дат выхода в API нет.',
        // Подписи чипов согласованы со своим рядом («счётчик включён»,
        // «уведомления включены») — тот же приём, что у «Анонимной статистики».
        badgeRowLabel: 'Счётчик на иконке',
        badgeOn: 'Включён',
        badgeOff: 'Выключен',
        notifyRowLabel: 'Уведомления',
        notifyOn: 'Включены',
        notifyOff: 'Выключены',
        // Строка состояния под вторым рядом существует только там, где от неё
        // что-то зависит: у выключенных уведомлений её нет вовсе.
        notifyGranted: 'Уведомления разрешены — Chrome покажет сообщение, когда выйдет серия.',
        notifyMissing:
            'Уведомления включены, но Chrome ещё не выдал разрешение — пока они не приходят. Счётчик на иконке работает и без него.',
        notifyAllow: 'Разрешить уведомления',
        notifyNeedsBadge:
            'Уведомления недоступны: пока счётчик выключен, расширение не проверяет выход серий.',
        episodesNoAuth:
            'Нужен вход: серии считаются по вашим спискам. Войдите через иконку расширения — после входа настройки станут доступны.',
        // Отказ в системном диалоге виден только так: разрешения нет, ряд
        // остаётся включённым, и без тоста клик по кнопке выглядел бы
        // проигнорированным.
        notifyDenied: 'Chrome не выдал разрешение на уведомления',

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
        helpBugNote: 'письмом на support@chakalabs.com',
        helpTelegram: 'Подписаться на канал в Telegram',
        helpTelegramNote: 'коротко о новых версиях',
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

// Ф12: heading of one relation group. Every kind but `adaptation` answers from
// the map alone; `adaptation` does not say a direction, so the direction is read
// off the MEDIUM of the rows in the group — a book row is the source the story
// came from («Первоисточник»), an anime row is a screen adaptation of it
// («Экранизации»). Taken from the row and not from the title we came from: that
// same rule then holds for ranobe and for the rare anime↔anime adaptations,
// where the type of the host says nothing.
//
// The server does not promise a group is uniform, so the mixed case gets a rule
// instead of a coin flip: ONE book anywhere in the group is enough to head it
// «Первоисточник». Calling a manga a screen adaptation is plainly false, while
// an anime under «Первоисточник» is merely imprecise — an anime can be the
// source of another one. The rule reads the whole group and so does not depend
// on the order the server sent it in.
//
// `items` is the WHOLE group as groupRelated() built it, never the portion
// currently on screen (30 rows, then «Показать ещё»): a book left in the
// unrendered tail would otherwise flip the heading on the next click.
export function relationGroupLabel(kind: RelationKind, items: readonly RelatedItem[]): string {
    const label = i18n.related.kinds[kind];
    if (typeof label === 'string') {
        return label;
    }
    // targetType is 'Anime' | 'Manga' and a ranobe card carries 'Manga'
    // (api/types), so "not anime" is exactly "book" — no kind check needed.
    const hasBook = items.some((item) => item.card.targetType !== 'Anime');
    return hasBook ? label.source : label.screen;
}

// Ф11-9: the first plural in the project, so the rules come from the platform
// rather than from a hand-written `n % 10` chain — Intl knows that 11 is «many»
// and 21 is «one». Built on first use and then kept: this module is imported by
// popup, options and search, while the only plural in the extension is the badge
// tooltip built in the background — an eager constructor would sit on the popup
// start path for nothing (docs/05, бюджеты).
let pluralRules: Intl.PluralRules | undefined;

interface PluralForms {
    one: string;
    few: string;
    many: string;
}

function plural(count: number, forms: PluralForms): string {
    pluralRules ??= new Intl.PluralRules('ru-RU');
    switch (pluralRules.select(count)) {
        case 'one':
            return forms.one;
        case 'few':
            return forms.few;
        // 'other' happens only for fractions, which a title count never is; it
        // shares the wording of 'many' («5 тайтлов»).
        default:
            return forms.many;
    }
}

// Ф11-9: tooltip of the extension icon. Zero is not «0 тайтлов» but the bare
// name: with an empty badge there is nothing to explain.
export function badgeTitleMessage(count: number): string {
    if (count <= 0) {
        return i18n.badge.idleTitle;
    }
    return i18n.badge.behindTitle
        .replace('{n}', String(count))
        .replace('{titles}', plural(count, i18n.badge.titleWords));
}

// Ф11-10: body of the notification. One episode and a range are two different
// sentences, not one template with a plural — «Вышла 3 серия» against «Вышли
// серии 2–3». Both bounds arrive already validated by the caller, so nothing
// here re-checks them: this function only formats.
export function airedEpisodesMessage(first: number, last: number): string {
    if (first >= last) {
        return i18n.notifications.airedOne.replace('{n}', String(first));
    }
    return i18n.notifications.airedRange
        .replace('{first}', String(first))
        .replace('{last}', String(last));
}

// Ф12: «Показано 30 из 92» over the «Показать ещё» button. Built here, next to
// the template, for the same reason as autoStatusMessage — the placeholder
// tokens must not leak into the component that renders the counter.
export function shownOfMessage(shown: number, total: number): string {
    return i18n.related.shownOf.replace('{n}', String(shown)).replace('{total}', String(total));
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
