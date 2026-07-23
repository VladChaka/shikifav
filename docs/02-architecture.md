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
| `auth.getState` | — | `{ status: 'anonymous' \| 'authorized', user? }` |
| `auth.validate` | — | `{ status: 'anonymous' \| 'authorized', user? }` (после whoami-сверки с сервером) |
| `auth.login` | — | `{ user }` |
| `auth.logout` | — | `{}` |
| `search.titles` | `{ query, type: 'anime'\|'manga'\|'ranobe', page? }` | `{ items: TitleCard[] }` |
| `rates.list` | `{ type, status, page }` | `{ items: RateRow[], hasMore }` |
| `rates.create` | `{ targetId, targetType, status }` | `{ rate }` |
| `rates.update` | `{ rateId, patch }` | `{ rate }` |
| `rates.delete` | `{ rateId }` | `{}` |
| `rates.increment` | `{ rateId }` | `{ rate }` |

Правила:
- Все типы сообщений — в одном `MessageMap` в `src/lib/messaging.ts`; хелперы `sendMessage(type, payload)` (типобезопасный) и `onMessage(handlers)` для background.
- «Сырые» `chrome.runtime.sendMessage` по коду запрещены.
- `rates.create` не содержит `user_id` — background берёт его из сохранённого `auth.user`.

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
    origin: 'https://shikimori.one' | 'https://shikimori.io';
    titleLang: 'ru' | 'romaji';
  };
}

// chrome.storage.session — живой кэш (терять не страшно):
// последний поисковый запрос+результаты, последняя открытая вкладка,
// последние загруженные списки. Используется для мгновенного первого рендера popup.
```

`src/lib/storage.ts` экспортирует типизированные `getLocal/setLocal/getSession/setSession` и дефолты `settings`.

## Rate limiter (`src/lib/api/http.ts`)
- Очередь промисов: не более **4 запросов/сек** и **80/мин** (запас к лимитам 5/90).
- Реализация: sliding window по массиву timestamps в памяти SW. При «засыпании» SW окно теряется — это безопасно: после пробуждения пустое окно всё равно ограничено 4 rps.
- `429` → пауза (заголовок Retry-After, иначе 2s → 4s → 8s, максимум 3 повтора) **только для GET**. POST/PATCH/DELETE автоматически не ретраить — вернуть ошибку в UI (иначе риск дублей).
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
- Context menu регистрируется в `chrome.runtime.onInstalled` (фаза 5).
- Долгих задач в background нет — SW может умирать свободно.

## Дерево модулей
```
src/lib/api/http.ts      # fetch wrapper: origin из настроек, заголовки, limiter, маппинг ошибок
src/lib/api/graphql.ts   # строки запросов SearchAnimes/SearchMangas/... + типы ответов
src/lib/api/rates.ts     # REST v2 user_rates: create/update/delete/increment/list
src/lib/api/auth.ts      # oauth: authorize url, exchange, refresh, whoami, logout
src/lib/api/types.ts     # TitleCard, RateRow, User, статусы и пр.
src/lib/messaging.ts     # MessageMap + sendMessage/onMessage
src/lib/storage.ts       # типизированный chrome.storage
src/lib/config.ts        # ORIGINS, APP_NAME, CLIENT_ID/SECRET из env
```

## Тестирование
- Vitest покрывает чистую логику: rate limiter (fake timers), вычисление expiresAt, редьюсер оптимистичных обновлений, маппинг ошибок.
- Слой chrome.* мокается минимально; интеграционные проверки — ручные smoke-чеклисты из docs/06-roadmap.md.
