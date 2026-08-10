# 02 — Архитектура

## Обзор компонентов (Manifest V3)

```
+------------------+      typed messages           +----------------------+
|  Popup (Vue 3)   | <---------------------------> |  Background SW       |
|  поиск/списки UI |   chrome.runtime.sendMessage  |  - api/http (fetch)  |
+------------------+                               |  - rate limiter      |
+------------------+                               |  - auth + refresh    |
|  Options (Vue)   | <---------------------------> |  - context menu (ф.5)|
+------------------+                               +----------+-----------+
+------------------+                                          |
|  Search page     | <----------------------------------------+
|  (фаза 5, Vue)   |          HTTPS: Bearer + User-Agent      |
+------------------+                                          v
     chrome.storage.local (tokens, settings)          Shikimori API
     chrome.storage.session (кэш поиска/списков)
```

## ADR-1: весь сетевой код — в background

**Статус:** Accepted

**Контекст.** Лимиты API жёсткие (5 rps / 90 rpm, бан IP за нарушение), popup может закрыться в любой момент (в т.ч. посреди записи), access-токен живёт сутки и требует refresh.

**Решение.** Popup / options / search-page не делают fetch к Shikimori. Все запросы идут сообщениями в background, который: (а) держит единственный rate limiter; (б) выполняет ensureToken/refresh single-flight; (в) доживает операции записи, даже если popup уже закрыт.

**Отклонённая альтернатива.** Прямые fetch из каждого контекста: меньше бойлерплейта, но limiter и refresh пришлось бы дублировать, легко получить гонку refresh и превышение лимитов из двух окон.

**Последствия.** + один код-путь, надёжные записи, простое тестирование api-слоя; − протокол сообщений нужно поддерживать; − background обязан отвечать быстро и не держать тяжёлого состояния в памяти.

## Протокол сообщений

Типизированный wrapper над `chrome.runtime.sendMessage` в `src/lib/messaging.ts`. Запрос: `{ type, payload }`. Ответ: `{ ok: true, data } | { ok: false, error: ApiError }`.

| type | payload | data |
|---|---|---|
| `ping` | — | `{ pong: true }` (проверка живости background) |
| `auth.getState` | — | `{ status: 'anonymous' \| 'authorized', user? }` |
| `auth.login` | — | `{ user }` |
| `auth.logout` | — | `{}` |
| `search.titles` | `{ query, type: 'anime'\|'manga'\|'ranobe', page? }` | `{ items: TitleCard[] }` |
| `rates.list` | `{ type, status, page }` | `{ items: RateRow[], hasMore }` |
| `calendar.list` | — | `{ items: CalendarItem[] }` (календарь онгоингов, фаза 7) |
| `titles.related` | `{ targetId, targetType: 'Anime'\|'Manga' }` | `{ items: RelatedItem[] }` (связанные тайтлы, фаза 12: один GraphQL на экран, список плоский и в серверном порядке) |
| `posters.fetch` | `{ type, ids: string[] }` | `{ posters: Record<string, string> }` (добор постеров, пустых в GraphQL: id → url; одно сообщение на корзину типов, внутри — REST-батчи по 50 id последовательно, Ф6-27, Ф7-14, Ф12-6) |
| `rates.create` | `{ targetId, targetType, status }` | `{ rate }` |
| `rates.update` | `{ rateId, patch }` | `{ rate }` |
| `rates.delete` | `{ rateId }` | `{}` |
| `rates.increment` | `{ rateId }` | `{ rate }` |
| `settings.setOrigin` | `{ origin }` | `{}` (смена домена API: завершает сессию, затем пишет origin) |
| `analytics.track` | `AnalyticsEvent` | `{}` (анонимная статистика, фаза 10; payload — закрытый union, свободного текста в нём нет по построению) |

Правила:
- Все типы сообщений — в одном `MessageMap` в `src/lib/messaging.ts`; хелперы `sendMessage(type, payload)` (типобезопасный) и `onMessage(handlers)` для background.
- «Сырые» `chrome.runtime.sendMessage` по коду запрещены.
- `rates.create` не содержит `user_id` — background берёт его из сохранённого `auth.user`.
- `calendar.list` — без payload и без страниц на проводе: у календаря нет кнопки «Ещё», поэтому пагинацию (`limit: 50`, последовательно, жёсткий предел 3 страницы) целиком делает `listCalendar()` в background и отвечает готовым списком. Ответ уже отфильтрован: только `status: ongoing` и только мои статусы — серверные аргументы `mylist` + `status` продублированы клиентским гардом в маппере (docs/03, чекбокс закрыт частично); гард отбрасывает только явно чужой статус тайтла, `status: null` остаётся (Ф7-14).
- `titles.related` — весь экран одним ответом, как `calendar.list`: страниц у `related` нет и на сервере, поэтому на проводе только тайтл, от которого пришли. Список идёт **плоским и в серверном порядке**: группировка по видам связи, дедуп по паре (`targetType`, `id`) и сортировка внутри группы — чистые решения в `src/lib/related.ts`, background ничего не перекладывает. При дубле (контракт их не запрещает) побеждает **старшая связь**, а не первая пришедшая: тайтл, пришедший как `other` и как `sequel`, стоит в «Сиквелах». `targetType` здесь — цель записи, а не раздел каталога: карточка ранобэ несёт `'Manga'`, и `mangas(ids:)` отвечает по ней без фильтра по `kind`.
- **Одно сообщение `posters.fetch` — на корзину типов, а не на экран.** У поиска, списков и календаря корзина одна, поэтому для них ничего не изменилось. Список связанных смешанный (аниме + манга + ранобэ в одной колонке), а сообщение принимает ровно один `SearchType` — значит, до трёх сообщений на экран. Расширять сообщение до списка корзин не стали осознанно: три REST-индекса — это три разных эндпоинта (`api/posters.ts`), то есть к Shikimori в обоих вариантах уходят те же три запроса, а переписывать пришлось бы всех существующих вызывающих. Правило 2 CLAUDE.md запрещает запрос **на тайтл**, а не три корзины на экран. Ответы трёх корзин сливаются по ключу (`targetType`, `id`): плоский merge по голому id повесил бы постер аниме №21 на мангу №21 (`cardKey`, `src/lib/title-card.ts`). Смешанная карта постеров — **отдельный тип** (`MixedPosterMap`, `Map` с брендированным ключом) и читается **своей** функцией `applyMixedPosters`, без параметра-ключа: попытка прочитать её обычным `applyPosters(..., idOf)` не компилируется. До этого разъезд ключей был бы молчаливым — три запроса и ни одного проставленного постера.
- `settings.setOrigin` — единственное сообщение про настройки. Смена домена завершает сессию по построению: токен выдан приложением на одном домене, кросс-доменная валидность не проверялась, а `.one` отвечает 301 на `POST /oauth/token` и там его даже нельзя обновить (docs/03, docs/04). Порядок в обработчике строгий: сначала `logout()`, только потом запись `origin` — обратный порядок открыл бы окно, где новый origin уже в storage, а старый токен ещё там, и любой запрос в этот момент ушёл бы на новый домен с чужим Bearer. Страница настроек после ответа перечитывает состояние авторизации.
- Остальные настройки UI пишет прямо в storage через `setSettings` (правило 1 CLAUDE.md ограничивает сеть, а не storage): лишнее сообщение будило бы service worker впустую, против бюджета открытия popup (docs/05).
- `analytics.track` — единственное сообщение, которое UI шлёт, ничего не ожидая: `reportEvent()` (`src/lib/analytics-report.ts`) делает `void sendMessage(...)`, потому что ни один кадр на экране не должен ждать измерения. Payload типизирован `AnalyticsEvent` — закрытым union, а не `{ name: string; params: object }`: открытая сигнатура позволила бы приложить к сообщению поисковый запрос, и обещание из PRIVACY.md держалось бы на внимательности автора вызова, а не на типах.

### Съём статистики (фаза 10)

Точек съёма три, и каждая — единственная в своём роде:

- **Background.** Таблица хендлеров обёрнута в `measured()` (`entrypoints/background.ts`): после успешного хендлера чистый маппинг `eventForMessage()` (`src/lib/analytics-from-message.ts`) решает, рождает ли это сообщение событие, а при ошибке хендлера её пропускает через `eventForError()` из того же файла и пробрасывает дальше. `eventForError()` сообщает `api_failed` только для ошибок самого обращения — `network`, `unauthorized`, `rate_limited`, `api` (с `status`); `internal` события не рождает: это свалка неклассифицированных отказов (закрытое окно OAuth, ненастроенный `APP_NAME`, нераспарсенный ответ), и `message` в ней несёт свободный текст, а PRIVACY.md обещает «ошибки обращения к Shikimori», а не все ошибки. Цена известна и принята: два случая, которые на самом деле отказ сервера — нераспарсенное тело (`http.ts`) и ответ GraphQL без `data` — в статистику не попадают. Чинится это классификацией их как `api` в источнике, а не здесь: там меняется и текст, который видит пользователь. Запрет держится типом — `params.kind` объявлен как `Exclude<ApiError['kind'], 'internal'>`. Хендлеры о существовании статистики не знают; чтобы ответить «что расширение сообщает по сообщениям», достаточно прочитать один маппинг.
- **UI.** То, что до background не доходит: вкладка, на которой открылся popup, и изменённая настройка. Через `reportEvent()`, то есть тем же сообщением.
- **Слушатель контекстного меню.** `context_menu_used` уходит прямым `trackEvent()` из `contextMenus.onClicked` (`entrypoints/background.ts`) — **мимо `measured()` и мимо `analytics-from-message.ts`**: клик по пункту меню приходит не сообщением, а событием chrome, и таблицы хендлеров не касается. Это единственное событие вне маппинга, поэтому полный ответ на «что расширение сообщает» — это `analytics-from-message.ts` **плюс** эта одна строка. Выделять её в маппинг не стали: у него на входе `MessageType`, а тут его нет.

Отправку делает `src/lib/api/analytics.ts` — **намеренно не через `http.ts`**. Тот клиент существует для Shikimori: цепляет Bearer, ставит User-Agent с именем OAuth-приложения и ставит запрос в очередь лимитера 4 rps / 80 rpm (правила 1–3 CLAUDE.md). К Google не должно уходить ничего из этого, а бюджет запросов к Shikimori не должен тратиться на измерения. Общее у двух клиентов ровно одно — оба живут в background.

Три состояния, и два из них молчат: пустой `.env` (нет свойства GA4) — полный no-op; выключенная настройка — ни одного запроса плюс удаление случайного идентификатора установки; иначе — один запрос на событие. Батчинга нет осознанно: в MV3 воркер умирает через несколько секунд простоя, и буфер под флаш — это буфер, который чаще всего выбрасывают.

## Хранилище

```ts
// chrome.storage.local — доступ ТОЛЬКО через src/lib/storage.ts
interface LocalState {
  auth?: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number; // ms epoch, уже с запасом -60с
    user: { id: number; nickname: string; avatarUrl: string };
  };
  settings: {
    origin: 'https://shikimori.one' | 'https://shikimori.io'; // default DEFAULT_ORIGIN = .io
    titleLang: 'ru' | 'romaji';            // default 'ru' — первая строка карточки
    // Ф6-19; каждый дефолт повторяет поведение до появления настройки
    theme: 'system' | 'light' | 'dark';    // default 'system' — по prefers-color-scheme
    startTab: 'search' | 'lists' | 'calendar' | 'last'; // default 'last' — восстановить session.lastTab (Ф7-9)
    quickStatus: UserRateStatus;           // default 'planned' — кнопка быстрого добавления
    defaultSearchType: SearchType;         // default 'anime'
    defaultListStatus: UserRateStatus;     // default 'watching' — стартовый фильтр «Моих списков»
    // Ф10-2. Единственный дефолт, который НЕ повторяет поведение до появления
    // настройки: opt-out по решению владельца — включено, пока не выключат.
    analytics: boolean;                    // default true
  };
  // Ф10-4. Случайный UUID, создаётся при первом отправленном событии и
  // удаляется при выключении статистики. Намеренно не выводится из аккаунта
  // Shikimori: он не должен быть способом связать измерение с человеком, и
  // должен переживать выход, ничего сам по себе не значая.
  analyticsClientId?: string;
}

// chrome.storage.session — живой кэш (терять не страшно):
// последний поисковый запрос+результаты, последняя открытая вкладка
// (`lastTab`: 'search' | 'lists' | 'calendar'), последние загруженные списки,
// последний календарь онгоингов (`lastCalendar`: { items, fetchedAt }).
// Используется для мгновенного первого рендера popup.
// Плюс одноразовый `pendingSearch` (фаза 5): запрос, который background передаёт
// popup при открытии из контекстного меню. Popup читает ключ при монтировании, а
// удаляет его НЕ сразу: только когда состояние авторизации стало `authorized` и
// запрос действительно ушёл под токеном (`App.vue`, watcher по `status`). Вход
// открывает окно OAuth, и Chrome закрывает popup вместе с ним — ключ, съеденный
// при чтении, потерял бы запрос насовсем (docs/05, «Поиск из контекстного меню»).
// И одноразовый `pendingOptionsSection` (фаза 8): раздел, на котором должна
// открыться страница настроек. Пишется кнопкой ♥ в шапке (запись обязательно
// `await`, страница читает ключ уже при монтировании) перед `openOptionsPage()`.
// Страница снимает ключ сразу после чтения — и при монтировании, и по
// `storage.onChanged`: уже открытую вкладку настроек `openOptionsPage()` только
// фокусирует, не перезагружая, поэтому иначе она осталась бы на прежнем разделе.
// Если открыть страницу не удалось, ключ снимает сама кнопка (как с
// `pendingSearch` в ф.5): иначе следующее открытие настроек, включая ⚙,
// прыгнуло бы на «Поддержать».
```

В `lastCalendar` лежат строки, а не построенное расписание: группы по дням считаются от текущих часов, поэтому кэшированное «Сегодня» показало бы вчерашний эфир под сегодняшним заголовком. `fetchedAt` — диагностика, а не TTL: вкладка календаря перезапрашивается при каждом показе (Ф7-7).

`src/lib/storage.ts` экспортирует типизированные `getLocal/setLocal/removeLocal/getSession/setSession/removeSession/clearSession` и дефолты `settings` (`DEFAULT_SETTINGS`). Читать настройки — только через `getSettings()` (дочитывает КАЖДЫЙ ключ дефолтом: профиль, записанный старой сборкой, не отдаёт `undefined`), писать — через `setSettings(patch)` (пер-ключевой мерж, UI одной настройки не затирает остальные). `clearSession()` — это «Очистить кэш» на странице настроек: сносит весь `storage.session`, авторизацию и настройки не трогает.

У вкладок дефолта мало: значение вне словаря (профиль, записанный другой сборкой) не восстанавливается ни из настройки `startTab`, ни из `session.lastTab` — popup открывается на «Поиске», а не в окне без активной вкладки (Ф7-9). Словарь вкладок и оба гарда живут в `storage.ts`, рядом со схемой. То же правило у разделов настроек: словарь `OPTIONS_SECTIONS` и гард `isOptionsSection` — там же, неизвестный `pendingOptionsSection` игнорируется, страница остаётся на «Виде» (Ф8-3). Подписанный список разделов внутри `OptionsPage.vue` — второй, и связывает их только тест (сверяет id со словарём); если они всё же разойдутся, страница выбирает `FALLBACK_OPTIONS_SECTION`, а не падает целиком (Ф8-6).

**Чтение storage никогда не отклоняется** (Ф6-23): отказ `chrome.storage` не должен ронять инициализацию экрана, поэтому каждое чтение настроек и кэша имеет фолбэк. Правило одно: на экране остаётся то, что уже есть, — на старте это `DEFAULT_SETTINGS`, при перечитывании по `onChanged` — последний валидный снапшот (в `theme.ts` — уже применённая тема: перекраска в системную из-за сбойного чтения хуже, чем удержание последнего известного значения).

Настройки применяются в UI по подписке на `storage.onChanged`: `src/composables/use-settings.ts` (модульное состояние, общее для всех компонентов страницы) и `src/lib/theme.ts` (ставит `data-theme` на `<html>`; вызывается ДО `mount()` в каждой точке входа). Поэтому смена настройки на вкладке настроек догоняет уже открытые popup и страницу поиска без перезагрузки.

## Rate limiter (`src/lib/api/rate-limiter.ts`; backoff и врезка в запросы — в `src/lib/api/http.ts`)
- Очередь промисов: не более **4 запросов/сек** и **80/мин** (запас к лимитам 5/90).
- Реализация: sliding window по массиву timestamps в памяти SW. При «засыпании» SW окно теряется — это безопасно: после пробуждения пустое окно всё равно ограничено 4 rps.
- `429` → пауза (заголовок Retry-After, иначе 2s → 4s → 8s, максимум 3 повтора) **только для GET**. Пауза ограничена сверху потолком `MAX_RETRY_AFTER_MS = 60_000` (`http.ts`): аномальный `Retry-After` от сервера не должен подвесить запрос — и вместе с ним service worker — на часы. POST/PATCH/DELETE автоматически не ретраить — вернуть ошибку в UI (иначе риск дублей). Уточнение: правило «только GET» реализовано флагом `retryOn429` в опциях запроса (по умолчанию `true` для GET, `false` для остальных методов), потому что GraphQL-чтение — это HTTP POST и включает флаг явно в graphql.ts. Намерение неизменно: запись (user_rates) и oauth-запросы никогда не ретраятся автоматически; повторы проходят через ту же очередь лимитера.
- Debounce поиска (300 мс) на стороне popup — первая линия; limiter — вторая.

## Модель ошибок
```ts
type ApiError =
  | { kind: 'network' }                                // fetch failed / timeout
  | { kind: 'unauthorized' }                           // 401 после попытки refresh
  | { kind: 'rate_limited'; retryAfterMs?: number }
  | { kind: 'api'; status: number; message: string }   // 4xx/5xx, включая 422
  | { kind: 'internal'; message: string };
```
UI маппит `kind` в русские тексты одной функцией `apiErrorMessage()` (`src/lib/i18n.ts`, тексты — `i18n.errors`). Действие у состояния ошибки одно — «Повторить»; на экране входа та же кнопка называется «Войти через Shikimori» до первой неудачи и «Повторить» после (`LoginScreen.vue`). Кнопки «Войти заново» в UI нет: «Сессия истекла. Войдите заново.» — это **текст** ошибки `unauthorized`, а не действие.

**Тела ответов и токены в логи не попадают вовсе.** `http.ts` пишет в `console.debug` только `kind` (и `status` у `kind: 'api'`), `messaging.ts` — тип сообщения и `kind`. Правило строже «без токенов»: сообщение об ошибке из тела ответа доходит до UI (`ApiError.message`), но не до консоли.

## Жизненный цикл service worker
- Ничего критичного в переменных модуля: токены и настройки перечитываются из storage в `ensureToken()`.
- Refresh — single-flight: параллельные вызовы ждут общий промис; перед стартом refresh перечитать storage (другой контекст мог уже обновить токен).
- Context menu (`src/lib/context-menu.ts`, фаза 5) регистрируется в `runtime.onInstalled` и повторно в `runtime.onStartup` — пункты меню персистентны, а `removeAll()` перед `create()` делает повтор идемпотентным и чинит профиль, где регистрация один раз не удалась. Слушатель `contextMenus.onClicked` вешается синхронно на старте SW, иначе клик по пункту на «холодном» воркере не найдёт обработчика. Клик кладёт выделение в `session.pendingSearch` (запись обязательно `await`, popup читает ключ уже при монтировании) и открывает popup через `browser.action.openPopup()` — API доступно всем расширениям с Chrome 127, дополнительных permissions не требует. Если popup открыть не удалось (нет активного окна, старый Chrome, отказ политики), ключ снимается и открывается запасной путь — вкладка `/search.html?q=…` (`src/lib/search-url.ts` — единственное место, где этот URL собирается и разбирается).
- Долгих задач в background нет — SW может умирать свободно.

## Дерево модулей
```
src/lib/api/http.ts      # fetch wrapper: origin из настроек, заголовки, limiter, маппинг ошибок
src/lib/api/rate-limiter.ts # очередь sliding window 4 rps / 80 rpm (чистая логика, без chrome.*)
src/lib/api/graphql.ts   # строки запросов SearchAnimes/SearchMangas/... + типы ответов
src/lib/api/rates.ts     # REST v2 user_rates: create/update/delete/increment — ровно четыре экспорта, все через authorizedRequest. Чтение списка (`listRates`) живёт в graphql.ts: запись REST, чтение GraphQL (правило 5 CLAUDE.md)
src/lib/api/posters.ts   # REST v1 ?ids=: постеры (image.x96) для тайтлов, у которых GraphQL отдал null (Ф6-27)
src/lib/api/auth.ts      # oauth: authorize url, exchange, refresh, whoami, logout
src/lib/api/user-agent-rule.ts # динамическое правило declarativeNetRequest: User-Agent = APP_NAME (Chrome не даёт поставить его на fetch)
src/lib/api/analytics.ts # GA4 Measurement Protocol: trackEvent(), намеренно мимо http.ts (фаза 10; пустой env = no-op)
src/lib/api/types.ts     # TitleCard, RateRow, User, статусы и пр.
src/lib/messaging.ts     # MessageMap + sendMessage/onMessage
src/lib/storage.ts       # типизированный chrome.storage + getSettings/setSettings
src/lib/config.ts        # ORIGINS, APP_NAME, CLIENT_ID/SECRET и ключи GA4 из env
src/lib/theme.ts         # применение настройки theme к <html> (Ф6-19)
src/lib/i18n.ts          # русские строки UI + statusLabel(status, media). Единственное исключение — подписи и пояснения площадок поддержки, они лежат в donations.ts рядом со своими адресами (осознанно, docs/05)
src/lib/title-name.ts    # displayTitle(name/russian, titleLang) — чистая логика
src/lib/external-url.ts  # httpsHref/mailtoHref — единственный гард внешних адресов (ссылки тайтлов, аватар, раздел поддержки; Ф8)
src/lib/title-url.ts     # titleHref(url) — ссылка на страницу тайтла; своей проверки не имеет, делегирует в external-url.ts (Ф6-26)
src/lib/donations.ts     # DONATION_METHODS/SUPPORT_ACTIONS + payHref/supportHref — содержимое раздела «Поддержать» как данные (фаза 8)
src/lib/manifest-key.ts  # правило выбора поля `key` манифеста из WXT_MANIFEST_KEY (фаза 9)
src/lib/analytics-events.ts      # закрытый union AnalyticsEvent — свободного текста в событии нет по построению (фаза 10)
src/lib/analytics-from-message.ts # чистый маппинг: eventForMessage(type, payload) и eventForError(ApiError)
src/lib/analytics-report.ts      # reportEvent() — «отправил и забыл» из UI, void sendMessage('analytics.track')
src/lib/poster-backfill.ts # UI-половина цепочки постеров: запрос недостающих (одно сообщение на корзину типов) + чистое применение к текущему списку (Ф6-27, Ф12-6)
src/lib/title-card.ts    # чистые хелперы над TitleCard: cardKey (идентичность = тип+id), RANOBE_KINDS (единственный список видов ранобэ), раскладка по корзинам постеров
src/lib/related.ts       # связанные тайтлы: порядок видов связи, группировка, дедуп по (тип, id) со старшинством связи (чистая логика, фаза 12). Чистая — но не только UI: `normalizeRelationKind` зовёт read-слой в background, сужая серверный enum на входе
src/lib/calendar-schedule.ts # календарь: группировка по локальным дням, время, номер серии, отставание (чистая логика, фаза 7)
src/lib/context-menu.ts  # регистрация пункта меню и обработка клика (фаза 5)
src/lib/search-url.ts    # сборка/разбор search.html?q= (фаза 5)
```

## Тестирование
- Vitest покрывает чистую логику: rate limiter (fake timers), вычисление expiresAt, редьюсер оптимистичных обновлений, маппинг ошибок.
- Слой chrome.* мокается минимально; интеграционные проверки — ручные smoke-чеклисты из docs/06-roadmap.md.
