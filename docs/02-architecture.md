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
| `rates.create` | `{ targetId, targetType, status }` | `{ rate }` |
| `rates.update` | `{ rateId, patch }` | `{ rate }` |
| `rates.delete` | `{ rateId }` | `{}` |
| `rates.increment` | `{ rateId }` | `{ rate }` |
| `settings.setOrigin` | `{ origin }` | `{}` (смена домена API: завершает сессию, затем пишет origin) |

Правила:
- Все типы сообщений — в одном `MessageMap` в `src/lib/messaging.ts`; хелперы `sendMessage(type, payload)` (типобезопасный) и `onMessage(handlers)` для background.
- «Сырые» `chrome.runtime.sendMessage` по коду запрещены.
- `rates.create` не содержит `user_id` — background берёт его из сохранённого `auth.user`.
- `calendar.list` — без payload и без страниц на проводе: у календаря нет кнопки «Ещё», поэтому пагинацию (`limit: 50`, последовательно, жёсткий предел 3 страницы) целиком делает `listCalendar()` в background и отвечает готовым списком. Ответ уже отфильтрован: только `status: ongoing` и только мои статусы — серверные аргументы `mylist` + `status` продублированы клиентским гардом в маппере (docs/03, чекбокс закрыт частично).
- `settings.setOrigin` — единственное сообщение про настройки. Смена домена завершает сессию по построению: токен выдан приложением на одном домене, кросс-доменная валидность не проверялась, а `.one` отвечает 301 на `POST /oauth/token` и там его даже нельзя обновить (docs/03, docs/04). Порядок в обработчике строгий: сначала `logout()`, только потом запись `origin` — обратный порядок открыл бы окно, где новый origin уже в storage, а старый токен ещё там, и любой запрос в этот момент ушёл бы на новый домен с чужим Bearer. Страница настроек после ответа перечитывает состояние авторизации.
- Остальные настройки UI пишет прямо в storage через `setSettings` (правило 1 CLAUDE.md ограничивает сеть, а не storage): лишнее сообщение будило бы service worker впустую, против бюджета открытия popup (docs/05).

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
    startTab: 'search' | 'lists' | 'last'; // default 'last' — восстановить session.lastTab
    quickStatus: UserRateStatus;           // default 'planned' — кнопка быстрого добавления
    defaultSearchType: SearchType;         // default 'anime'
    defaultListStatus: UserRateStatus;     // default 'watching' — стартовый фильтр «Моих списков»
  };
}

// chrome.storage.session — живой кэш (терять не страшно):
// последний поисковый запрос+результаты, последняя открытая вкладка,
// последние загруженные списки. Используется для мгновенного первого рендера popup.
// Плюс одноразовый `pendingSearch` (фаза 5): запрос, который background передаёт
// popup при открытии из контекстного меню. Popup удаляет ключ сразу после чтения.
```

`src/lib/storage.ts` экспортирует типизированные `getLocal/setLocal/removeLocal/getSession/setSession/removeSession/clearSession` и дефолты `settings` (`DEFAULT_SETTINGS`). Читать настройки — только через `getSettings()` (дочитывает КАЖДЫЙ ключ дефолтом: профиль, записанный старой сборкой, не отдаёт `undefined`), писать — через `setSettings(patch)` (пер-ключевой мерж, UI одной настройки не затирает остальные). `clearSession()` — это «Очистить кэш» на странице настроек: сносит весь `storage.session`, авторизацию и настройки не трогает.

**Чтение storage никогда не отклоняется** (Ф6-23): отказ `chrome.storage` не должен ронять инициализацию экрана, поэтому каждое чтение настроек и кэша имеет фолбэк. Правило одно: на экране остаётся то, что уже есть, — на старте это `DEFAULT_SETTINGS`, при перечитывании по `onChanged` — последний валидный снапшот (в `theme.ts` — уже применённая тема: перекраска в системную из-за сбойного чтения хуже, чем удержание последнего известного значения).

Настройки применяются в UI по подписке на `storage.onChanged`: `src/composables/use-settings.ts` (модульное состояние, общее для всех компонентов страницы) и `src/lib/theme.ts` (ставит `data-theme` на `<html>`; вызывается ДО `mount()` в каждой точке входа). Поэтому смена настройки на вкладке настроек догоняет уже открытые popup и страницу поиска без перезагрузки.

## Rate limiter (`src/lib/api/rate-limiter.ts`; backoff и врезка в запросы — в `src/lib/api/http.ts`)
- Очередь промисов: не более **4 запросов/сек** и **80/мин** (запас к лимитам 5/90).
- Реализация: sliding window по массиву timestamps в памяти SW. При «засыпании» SW окно теряется — это безопасно: после пробуждения пустое окно всё равно ограничено 4 rps.
- `429` → пауза (заголовок Retry-After, иначе 2s → 4s → 8s, максимум 3 повтора) **только для GET**. POST/PATCH/DELETE автоматически не ретраить — вернуть ошибку в UI (иначе риск дублей). Уточнение: правило «только GET» реализовано флагом `retryOn429` в опциях запроса (по умолчанию `true` для GET, `false` для остальных методов), потому что GraphQL-чтение — это HTTP POST и включает флаг явно в graphql.ts. Намерение неизменно: запись (user_rates) и oauth-запросы никогда не ретраятся автоматически; повторы проходят через ту же очередь лимитера.
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
UI маппит `kind` в русские тексты и действия («Повторить», «Войти заново»). Стектрейсы и тела ответов — только в console.debug, без токенов.

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
src/lib/api/rates.ts     # REST v2 user_rates: create/update/delete/increment/list
src/lib/api/auth.ts      # oauth: authorize url, exchange, refresh, whoami, logout
src/lib/api/types.ts     # TitleCard, RateRow, User, статусы и пр.
src/lib/messaging.ts     # MessageMap + sendMessage/onMessage
src/lib/storage.ts       # типизированный chrome.storage + getSettings/setSettings
src/lib/config.ts        # ORIGINS, APP_NAME, CLIENT_ID/SECRET из env
src/lib/theme.ts         # применение настройки theme к <html> (Ф6-19)
src/lib/i18n.ts          # все русские строки UI + statusLabel(status, media)
src/lib/title-name.ts    # displayTitle(name/russian, titleLang) — чистая логика
src/lib/calendar-schedule.ts # календарь: группировка по локальным дням, время, номер серии, отставание (чистая логика, фаза 7)
src/lib/context-menu.ts  # регистрация пункта меню и обработка клика (фаза 5)
src/lib/search-url.ts    # сборка/разбор search.html?q= (фаза 5)
```

## Тестирование
- Vitest покрывает чистую логику: rate limiter (fake timers), вычисление expiresAt, редьюсер оптимистичных обновлений, маппинг ошибок.
- Слой chrome.* мокается минимально; интеграционные проверки — ручные smoke-чеклисты из docs/06-roadmap.md.
