# 03 — API Shikimori

Официальная документация: `{origin}/api/doc` (REST v1/v2) и `{origin}/api/doc/graphql` (GraphQL-песочница). Позиция разработчиков сайта: для чтения предпочитать GraphQL, сайт не парсить.

## Базовые константы
```ts
// src/lib/config.ts
export const ORIGINS = ['https://shikimori.one', 'https://shikimori.io'] as const;
export const DEFAULT_ORIGIN = ORIGINS[0];
export const APP_NAME = import.meta.env.WXT_SHIKI_APP_NAME as string; // = имя OAuth-приложения (docs/04)
export const CLIENT_ID = import.meta.env.WXT_SHIKI_CLIENT_ID as string;
export const CLIENT_SECRET = import.meta.env.WXT_SHIKI_CLIENT_SECRET as string;
```
Домены сайта менялись (org → one → me → io), поэтому origin хранится в настройках и оба присутствуют в host_permissions.

## Обязательные заголовки каждого запроса
```
User-Agent: <APP_NAME>          # ИМЯ OAuth-приложения, не строка браузера
Authorization: Bearer <token>   # для персональных данных и любой записи
Content-Type: application/json  # (или x-www-form-urlencoded для /oauth/token)
```

**Нюанс с User-Agent в браузере.** `fetch()` из service worker в Chrome обычно позволяет переопределить User-Agent, но это надо проверить в первый же день фазы 1 (сделать запрос и посмотреть заголовки в DevTools background-воркера или через эхо-сервис). Если заголовок не подменяется — включить fallback: permission `declarativeNetRequest` + правило:
```json
{
  "id": 1,
  "priority": 1,
  "action": {
    "type": "modifyHeaders",
    "requestHeaders": [
      { "header": "User-Agent", "operation": "set", "value": "<APP_NAME>" }
    ]
  },
  "condition": {
    "requestDomains": ["shikimori.one", "shikimori.io"],
    "resourceTypes": ["xmlhttprequest"]
  }
}
```

## Лимиты
**5 запросов/сек и 90/мин.** Наш клиент держит 4 rps / 80 rpm (docs/02). Систематическое превышение → 429 и риск бана IP.

## GraphQL (чтение)

Endpoint: `POST {origin}/api/graphql`, тело `{ "query": "...", "variables": {...} }`. С Bearer-токеном поле `userRate` возвращает мой статус по тайтлу (иначе null).

### Интроспекция — выполнить в начале фазы 2, ДО написания запросов
```bash
curl -s -X POST https://shikimori.one/api/graphql \
  -H 'Content-Type: application/json' -H 'User-Agent: <APP_NAME>' \
  -d '{"query":"{ __type(name: \"Anime\") { fields { name type { name kind ofType { name } } } } }"}'
```
Повторить для типов `Manga`, `Poster`, `UserRate` и для аргументов запросов:
```bash
-d '{"query":"{ __schema { queryType { fields { name args { name type { name kind ofType { name } } } } } } }"}'
```
Результаты (точные имена полей) зафиксировать прямо в этом файле, обновив запросы ниже.

### Поиск аниме (эталон; поля сверить интроспекцией)
```graphql
query SearchAnimes($search: String, $limit: Int, $page: Int) {
  animes(search: $search, limit: $limit, page: $page) {
    id
    malId
    name          # ромадзи
    russian
    kind          # tv, movie, ova, ona, special, music, ...
    score
    status        # anons, ongoing, released
    episodes
    episodesAired
    airedOn { year }
    poster { mainUrl originalUrl }     # TODO(verify): поле маленького превью
    userRate { id status episodes score }
  }
}
```

### Поиск манги / ранобэ
```graphql
query SearchMangas($search: String, $limit: Int, $page: Int, $kind: MangaKindString) {
  mangas(search: $search, limit: $limit, page: $page, kind: $kind) {
    id
    name
    russian
    kind          # manga, manhwa, manhua, light_novel, novel, one_shot, doujin
    score
    status
    volumes
    chapters
    airedOn { year }
    poster { mainUrl originalUrl }
    userRate { id status chapters volumes score }
  }
}
```
Ранобэ = `kind: "light_novel,novel"` (значения через запятую — TODO(verify) точный синтаксис и имя scalar-типа аргумента).

### Мои списки — два варианта, выбрать в фазе 3
- **Вариант А (предпочтительный, если работает):** те же `animes` / `mangas` с аргументом `mylist: "watching"` — сразу возвращает карточки с userRate.
- **Вариант Б:** REST `GET /api/v2/user_rates?user_id=<id>&target_type=Anime&status=watching&limit=30&page=1`, затем дозапросить карточки одним GraphQL-запросом по `ids`.

## REST v2 — запись списков
Все запросы с Bearer и User-Agent. Требуемый OAuth scope: `user_rates`.

### Создать запись
```
POST {origin}/api/v2/user_rates
{
  "user_rate": {
    "user_id": <мой id из whoami>,
    "target_id": <id тайтла>,
    "target_type": "Anime" | "Manga",
    "status": "planned"
  }
}
```
Ответ 201 — объект user_rate с `id` (сохранить: нужен для PATCH/DELETE/increment).

### Статусы
| API | UI |
|---|---|
| planned | Запланировано |
| watching | Смотрю / Читаю |
| rewatching | Пересматриваю / Перечитываю |
| completed | Просмотрено / Прочитано |
| on_hold | Отложено |
| dropped | Брошено |

### Обновить (статус, оценка, прогресс)
```
PATCH {origin}/api/v2/user_rates/{rate_id}
{ "user_rate": { "status": "watching", "score": 8, "episodes": 5 } }
```
Поля: `status`, `score` (0–10, 0 = без оценки), `episodes`, `chapters`, `volumes`, `rewatches`, `text`.

### Удалить
```
DELETE {origin}/api/v2/user_rates/{rate_id}   → 204
```

### +1 эпизод / глава
```
POST {origin}/api/v2/user_rates/{rate_id}/increment
```
Инкрементирует прогресс (у аниме — episodes; у манги — chapters, TODO(verify)). В `completed` автоматически НЕ переводим — предлагаем пользователю (US-6).

## Профиль
```
GET {origin}/api/users/whoami
→ { "id": ..., "nickname": "...", "avatar": "<url>", "image": { ... }, ... }
```
Вызывается после логина; `id` обязателен для создания user_rates.

## Обработка ошибок API
| Код | Действие |
|---|---|
| 401 | refresh токена → повтор 1 раз → при неудаче logout-состояние |
| 403 | не хватает scope — проверить, что при авторизации запрошен `user_rates` |
| 404 (user_rate) | запись удалили на сайте → убрать из UI, не фатал |
| 422 | валидация; показать message из тела ответа |
| 429 | backoff по правилам limiter (docs/02) |
| 5xx | тост «Shikimori недоступен», retry только для GET |

## Проверить при реализации (результат фиксировать здесь же: чекбокс + заметка)
- [ ] Точные поля типа `Poster` — нужен URL маленького превью для списков (интроспекция)
- [ ] Поведение `userRate` в GraphQL с токеном и без
- [ ] Синтаксис множественного `kind` для ранобэ (`"light_novel,novel"`)
- [ ] Существует ли аргумент `mylist` у `animes`/`mangas` (для варианта А списков)
- [ ] `increment` для манги: главы или что-то другое
- [ ] Уходит ли кастомный User-Agent через fetch в текущем Chrome (иначе включить DNR-fallback)
  - Как проверить (дев-код уже в `entrypoints/background.ts`, помечен `TEMP UA-check (task 6)`): `pnpm dev` → `chrome://extensions` → на карточке расширения ссылка «service worker» → в открывшемся DevTools вкладка Network → найти запрос к shikimori (`/oauth/token` без входа или `/api/users/whoami` после входа; в Console будет `UA-check request fired`) → Headers → Request Headers → `User-Agent`. Значение `ShikiFav` — заголовок уходит, отметить чекбокс и удалить временный код; стандартный UA Chrome (`Mozilla/5.0 ...`) — включаем DNR-fallback (правило выше). Если запрос не виден — переоткрыть DevTools ДО перезапуска SW (кнопка Update на карточке) и смотреть снова.
- [ ] Отвечает ли API на shikimori.io идентично shikimori.one, включая Bearer-авторизацию (иначе оставить в настройках только .one)
- [ ] Поддержка PKCE сервером (детали в docs/04 §5)
- [ ] Форма ответа whoami: поле `avatar` (маппинг в `avatarUrl`, src/lib/api/auth.ts) — подтвердить при первом живом входе
