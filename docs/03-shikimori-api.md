# 03 — API Shikimori

Официальная документация: `{origin}/api/doc` (REST v1/v2) и `{origin}/api/doc/graphql` (GraphQL-песочница). Позиция разработчиков сайта: для чтения предпочитать GraphQL, сайт не парсить.

## Базовые константы
```ts
// src/lib/config.ts
export const ORIGINS = ['https://shikimori.one', 'https://shikimori.io'] as const;
// Дефолтный origin — 'https://shikimori.io' (DEFAULT_ORIGIN в src/lib/config.ts)
export const APP_NAME: string = import.meta.env.WXT_SHIKI_APP_NAME ?? ''; // = имя OAuth-приложения (docs/04)
export const CLIENT_ID: string = import.meta.env.WXT_SHIKI_CLIENT_ID ?? '';
export const CLIENT_SECRET: string = import.meta.env.WXT_SHIKI_CLIENT_SECRET ?? '';
```
Аннотация типа с `?? ''`, а не каст `as string`: переменная окружения объявлена необязательной, и ненастроенный `.env` даёт пустую строку, которую `http.ts` ловит перед первым `fetch` (`APP_NAME is not configured`), а не `undefined` в заголовке.
Домены сайта менялись (org → one → me → io), поэтому origin хранится в настройках и оба присутствуют в host_permissions.

**301 на shikimori.one (проверка владельца 2026-07-22).** `POST https://shikimori.one/oauth/token` отвечает 301 на shikimori.io; при следовании редиректу браузер превращает POST в GET → 404 (плюс браузеры срезают Authorization на cross-origin редиректах). Поэтому .one сейчас непригоден как API-origin и дефолт переключён на shikimori.io; .one остаётся в настройках на случай очередной смены доменов.

## Обязательные заголовки каждого запроса
```
User-Agent: <APP_NAME>          # ИМЯ OAuth-приложения, не строка браузера
Authorization: Bearer <token>   # для персональных данных и любой записи
Content-Type: application/json  # (или x-www-form-urlencoded для /oauth/token)
```

**Нюанс с User-Agent в браузере.** Проверено (Chrome 150, 2026-07-22): `fetch()` из MV3 service worker НЕ позволяет переопределить User-Agent — браузер подменяет его на стандартный `Mozilla/5.0 ...`. Включён fallback: permission `declarativeNetRequestWithHostAccess` (не `declarativeNetRequest`: modifyHeaders в любом случае требует host permissions на целевой URL, а этот вариант не даёт прав сверх уже имеющихся host_permissions) + динамическое правило, которое регистрируется в background на каждом старте SW (`src/lib/api/user-agent-rule.ts`, id=1, идемпотентно):
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
    "excludedInitiatorDomains": ["shikimori.one", "shikimori.io"],
    "resourceTypes": ["xmlhttprequest"]
  }
}
```

**`excludedInitiatorDomains` — не украшение.** `modifyHeaders` срабатывает там, где host-доступ есть и к URL запроса, и к инициатору, а оба домена Shikimori лежат в `host_permissions`. Без исключения правило переписывало бы User-Agent и у AJAX самого сайта в обычной вкладке пользователя: его браузинг уходил бы под именем нашего приложения — ровно тот бан IP, от которого правило и защищает. Запросы из service worker'а инициируются origin'ом расширения, под исключение не попадают и заголовок получают. Альтернатива точнее, но дороже: session-правило с `tabIds: [chrome.tabs.TAB_ID_NONE]` — условие `tabIds` поддерживается только для session-scoped правил, то есть `updateSessionRules` вместо `updateDynamicRules`. (Найдено аудитом 2026-08-04.)

## Лимиты
**5 запросов/сек и 90/мин.** Наш клиент держит 4 rps / 80 rpm (docs/02). Систематическое превышение → 429 и риск бана IP.

## GraphQL (чтение)

Endpoint: `POST {origin}/api/graphql`, тело `{ "query": "...", "variables": {...} }`. С Bearer-токеном поле `userRate` возвращает мой статус по тайтлу (иначе null).

### Интроспекция (выполнена 2026-07-23 на shikimori.io, результаты ниже)
Сервер ограничивает глубину GraphQL-запроса: **max depth 5** (`Query has depth of 7, which exceeds max depth of 5`) — интроспекцию держать плоской:
```bash
curl -s -X POST https://shikimori.io/api/graphql \
  -H 'Content-Type: application/json' -H 'User-Agent: <APP_NAME>' \
  -d '{"query":"{ __type(name: \"Anime\") { fields { name type { kind name ofType { kind name } } } } }"}'
```
Аргументы запросов — через `__type(name: "Query")` (вариант `__schema { queryType }` на уровень глубже и не влезает в лимит):
```bash
-d '{"query":"{ __type(name: \"Query\") { fields { name args { name type { kind name } } } } }"}'
```

### Результаты интроспекции (2026-07-23, дополнено 2026-07-24)
- **Anime:** `id: ID!`, `malId: ID`, `name: String!`, `russian: String`, `kind: AnimeKindEnum`, `score: Float`, `status: AnimeStatusEnum`, `episodes: Int!`, `episodesAired: Int!`, `airedOn: IncompleteDate` (подполе `year` подтверждено живым запросом), `poster: Poster`, `userRate: UserRate`, `url: String` (Ф6-26: абсолютный адрес страницы тайтла **на том домене, с которого пришёл ответ** — проверено 2026-07-28, запрос на `.io` дал `https://shikimori.io/animes/59978-…`; поэтому настройка домена учитывается сама и адрес в коде не собирается. То же поле есть у `Manga`).

  **`poster` бывает пустым:** у аниме с `rating: "rx"` он приходит `null` — см. раздел «REST v1 — добор постеров». У `Manga` поля `rating` нет вовсе (`Field 'rating' doesn't exist on type 'Manga'`), поэтому логика добора строится по признаку «постер пустой», а не по типу или рейтингу.
- **`id: ID!` сериализуется строкой** (например `"52991"`), значение числовое → для REST `target_id` конвертировать `Number(id)`.
- **Poster** — все поля `String!`: `id`, `miniUrl`, `mini2xUrl`, `miniAltUrl`, `miniAlt2xUrl`, `mainUrl`, `main2xUrl`, `mainAltUrl`, `mainAlt2xUrl`, `previewUrl`, `preview2xUrl`, `previewAltUrl`, `previewAlt2xUrl`, `originalUrl`. Для карточки поиска (бокс 60×94 с Ф6-25) — **`miniUrl`**: он и приходит ровно 60×94 px webp, то есть показывается без пересчёта; `mini2xUrl` (120×188) — retina. Замеры остальных вариантов 2026-07-27: `previewUrl` 160×226 (пропорция ДРУГАЯ, 1:1,413 против 1:1,567 у mini), `mainUrl` 225×318–355 (высота плавает), `originalUrl` 685×975…760×1200 jpeg 362–379 КБ.
- **UserRate:** `id: ID!`, `status: UserRateStatusEnum!`, `episodes: Int!`, `chapters: Int!`, `volumes: Int!`, `score: Int!`, `rewatches: Int!`, `text: String`, `anime: Anime`, `manga: Manga`, `createdAt`/`updatedAt: ISO8601DateTime!`.
- **UserRateStatusEnum** = `planned | watching | rewatching | completed | on_hold | dropped` — 1:1 с REST-статусами.
- **Аргументы `animes`:** `search: String`, `limit: PositiveInt`, `page: PositiveInt`, `kind: AnimeKindString`, `status: AnimeStatusString`, `season: SeasonString`, `score: Int`, `duration: DurationString`, `rating: RatingString`, `origin: OriginString`, `genre/studio/franchise: String`, `censored: Boolean`, `mylist: MylistString`, `ids/excludeIds: String`, `order: OrderEnum`.
- **Аргументы `mangas`:** как у `animes` минус `duration/rating/origin/studio`, плюс `publisher: String`; `kind: MangaKindString`. Перепроверено интроспекцией 2026-07-24: `kind: MangaKindString` и `mylist: MylistString` на месте.
- **Manga (интроспекция 2026-07-24):** `chapters: Int!` и `volumes: Int!` — non-null; `status: MangaStatusEnum` — nullable (как `status` у Anime). **MangaStatusEnum** = `anons | ongoing | released | paused | discontinued` (на два значения больше, чем AnimeStatusEnum).
- **`limit`/`page` — скаляр `PositiveInt`, НЕ `Int`:** переменные в запросах объявлять `$limit: PositiveInt` (с `Int` сервер отклонит переменную по несовместимости типов).
- **`AnimeKindString`/`MangaKindString`/`MylistString`** — скаляры вида «List of values separated by comma», `!` перед значением — негативный фильтр. `MangaKindString`: `manga, manhwa, manhua, light_novel, novel, one_shot, doujin`. `MylistString`: те же 6 статусов, что и `UserRateStatusEnum`.

### Поиск аниме (эталон; поля подтверждены интроспекцией и живым публичным запросом 2026-07-23)
```graphql
query SearchAnimes($search: String, $limit: PositiveInt, $page: PositiveInt) {
  animes(search: $search, limit: $limit, page: $page) {
    id            # ID! (строка с числом; для REST target_id — Number(id))
    malId         # ID, nullable
    name          # ромадзи, String!
    russian       # String, nullable
    kind          # AnimeKindEnum: tv, movie, ova, ona, special, tv_special, music, pv, cm
    score         # Float, nullable; 0.0 = оценки нет (анонсы)
    status        # AnimeStatusEnum: anons, ongoing, released
    episodes      # Int!
    episodesAired # Int!
    airedOn { year }
    poster { miniUrl mini2xUrl }            # 60×94 webp — ровно бокс карточки поиска
    userRate { id status episodes score }   # null без Bearer или если тайтла нет в списке
    url                                     # абсолютный адрес на домене ответа (Ф6-26, см. Anime.url выше)
  }
}
```

### Поиск манги / ранобэ (поля подтверждены живым запросом 2026-07-23)
```graphql
query SearchMangas($search: String, $limit: PositiveInt, $page: PositiveInt, $kind: MangaKindString) {
  mangas(search: $search, limit: $limit, page: $page, kind: $kind) {
    id
    name
    russian
    kind          # MangaKindEnum: manga, manhwa, manhua, light_novel, novel, one_shot, doujin
    score         # Float, nullable
    status        # MangaStatusEnum: anons, ongoing, released, paused, discontinued
    volumes       # Int!
    chapters      # Int!
    airedOn { year }
    poster { miniUrl mini2xUrl }
    userRate { id status chapters volumes score }
    url           # абсолютный адрес на домене ответа (Ф6-26)
  }
}
```
Ранобэ = `kind: "light_novel,novel"` — подтверждено живым запросом 2026-07-23: вернул light_novel-тайтлы; синтаксис «значения через запятую» явно описан в description скаляра `MangaKindString`.

Манга без ранобэ = `kind: "!light_novel,!novel"` (негативный фильтр) — подтверждено живым запросом 2026-07-24: `mangas(search: "monogatari", kind: "!light_novel,!novel", limit: 10)` вернул только manga/one_shot/doujin, тогда как тот же поиск без kind-фильтра содержит light_novel- и novel-тайтлы.

### Мои списки — вариант А (выбран в фазе 3)
Списки читаются теми же `animes` / `mangas` с аргументом `mylist` — страница карточек сразу с `userRate`, без `user_id` в read-пути. Аргумент `mylist: MylistString` подтверждён интроспекцией 2026-07-23, фильтрация по владельцу токена — owner-verification 2026-07-23 (чекбокс «Существует ли аргумент `mylist`…» ниже).

**Отклонённый вариант Б:** REST `GET /api/v2/user_rates?user_id=<id>&target_type=Anime&status=watching&limit=30&page=1` + дозапрос карточек одним GraphQL по `ids` — два запроса на страницу вместо одного. Остаётся запасным путём, если `mylist` под Bearer перестанет фильтровать по владельцу.

```graphql
query MylistAnimes($mylist: MylistString, $limit: PositiveInt, $page: PositiveInt) {
  animes(mylist: $mylist, limit: $limit, page: $page) {
    id
    malId
    name
    russian
    kind
    score
    status
    episodes                                # всего серий, 0 = неизвестно
    episodesAired
    airedOn { year }
    poster { miniUrl mini2xUrl }
    userRate { id status episodes score }   # прогресс и оценка строки списка
    url
  }
}
```
Манга и ранобэ — `MylistMangas` (`MYLIST_MANGAS_QUERY` в `src/lib/api/graphql.ts`): те же `mylist`/`limit`/`page` плюс `$kind: MangaKindString`, которым разводятся вкладки «Манга» и «Ранобэ», а поля урезаны до нужных строке — `id name russian chapters poster userRate { id status chapters score } url`.

`limit` = 30 (`LIST_LIMIT`), «есть ещё» считается по длине СЫРОЙ страницы, до отсева записей без `userRate` (docs/06). `order` не задаётся — порядок отдаёт сервер, поэтому тайтл, переехавший в другой список на сайте, может сдвинуться между страницами; известный мелкий риск фазы 3.

## Календарь онгоингов (фаза 7)

Всё в этом разделе проверено живыми запросами и интроспекцией на shikimori.io **2026-07-28** — переоткрывать не нужно.

- **Корневого `calendar` в GraphQL нет.** Поля `Query`: `animes, characters, contests, currentUser, genres, mangas, people, userRates, users`. Календарь собирается из `animes`.
- **`Anime.nextEpisodeAt: ISO8601DateTime`** (nullable) и **`Anime.duration: Int`**. Живой запрос `{ animes(status: "ongoing", limit: 3, order: popularity) { id name russian nextEpisodeAt episodes episodesAired status } }` вернул `One Piece → "2026-08-02T17:15:00+03:00"`, `Re:Zero 4 → "2026-07-29T16:00:00+03:00"` — дата приходит со смещением, то есть это момент времени, а не «дата сайта».
- **У `Manga` поля `nextEpisodeAt` нет** (интроспекция полного списка полей) и аналога нет → **календарь anime-only**, вкладок манги/ранобэ в нём не будет.
- **Потолок `limit` у `animes` = 50.** Большие значения молча клампятся (`limit: 51` → 50, `limit: 100` → 50), ошибки нет. Больше 50 строк — только пагинацией по `page`.
- **В `OrderEnum` нет сортировки по дате следующей серии:** `id, id_desc, ranked, kind, popularity, name, aired_on, episodes, status, random, ranked_random, ranked_shiki, created_at, created_at_desc, updated_at, updated_at_desc`. → **сортировка календаря клиентская** (`src/lib/calendar-schedule.ts`).
- **У `status: "anons"` `nextEpisodeAt` всегда `null`** (10 из 10 топ-анонсов) — но это про анонсы, а не про мой статус: серверный `status: "ongoing"` отсекает их сам, а выходящий тайтл из «Запланировано» приходит с нормальной датой. Поэтому `mylist` календаря — три статуса, `watching,rewatching,planned` (owner-verification 2026-07-28, обоснование — docs/06, «Статусы календаря»).
- **Среди топ-50 популярных онгоингов 4 без `nextEpisodeAt` (~8%)** → строки без даты — нормальный случай, их показываем группой «Дата не объявлена», а не выбрасываем.
- **REST `/api/calendar` жив** (HTTP 200, без авторизации, принимает `?limit=`) и отдаёт `next_episode`, `next_episode_at`, `duration`, `anime { id, name, russian, image {...}, url, kind, score, status, episodes, episodes_aired, aired_on, released_on }`. **Не используется:** список глобальный (не «мой»), `userRate` он не отдаёт, а `duration` уже есть в GraphQL — фильтровать глобальную выдачу по своему списку на клиенте дороже одного запроса с `mylist`.

### Календарь — эталонный запрос (фаза 7)
```graphql
query CalendarAnimes($limit: PositiveInt, $page: PositiveInt) {
  animes(mylist: "watching,rewatching,planned", status: "ongoing", limit: $limit, page: $page) {
    id            # ID! (строка с числом; для REST target_id — Number(id))
    name          # ромадзи, String!
    russian       # String, nullable
    status        # AnimeStatusEnum; запрашивается для клиентского гарда (Ф7-5)
    episodes      # Int!, 0 = общее число неизвестно (One Piece)
    episodesAired # Int!, номер следующей серии = episodesAired + 1
    nextEpisodeAt # ISO8601DateTime, nullable (~8% онгоингов без даты)
    poster { miniUrl mini2xUrl }   # 60×94 webp, как в карточке поиска
    userRate { id status episodes }
    url           # абсолютный адрес на домене ответа (см. Anime.url выше)
  }
}
```
`limit` держать ≤ 50 (потолок выше), сортировку и группировку по дням делать на клиенте.

Запрос выше приведён к реализации Ф7-5 (`CALENDAR_ANIMES_QUERY` в `src/lib/api/graphql.ts`), два отличия от первой редакции — следствие owner-verification 2026-07-28:
- `mylist` из трёх статусов, а не двух (обоснование — docs/06, «Статусы календаря»);
- запрашивается `status` тайтла: маппер дублирует серверную фильтрацию клиентским гардом (мой статус из списка `watching,rewatching,planned` + `status` тайтла не равен явно чужому). Чекбокс «Комбинация `mylist` + `status` под Bearer» закрыт частично, и протёкший в календарь released был бы молчаливым неверным ответом. `Anime.status` nullable, поэтому `status: null` гард НЕ отбрасывает (Ф7-14): пропавшая строка на экране не видна и диагностируется хуже протёкшей, а серверный `status: "ongoing"` подтверждён — раз строка пришла в ответ, молчание о собственном статусе трактуется в её пользу.

## Франшизы и связанные тайтлы (фаза 12)

Всё в этом разделе проверено интроспекцией и живыми публичными запросами на shikimori.io **2026-08-10** (без Bearer, поэтому `userRate` во всех ответах `null` — это ожидаемо, а не находка). Заготовка «содержимое списков не интроспектировалось» от 2026-07-28 этим разделом закрыта.

### Второй потолок сервера: `max complexity 190`
Кроме `max depth 5` у сервера есть **необъявленный лимит сложности запроса**: `Query has complexity of 207, which exceeds max complexity of 190`. В `/api/doc/graphql` он не описан, наткнуться на него можно только запросом. Замеры:

| Запрос | Результат |
|---|---|
| `related { anime { <полная карточка> } }` | проходит |
| `related { anime { <полная> } manga { <полная> } }` | **проходит** (это главный запрос фазы) |
| `chronology { <полная карточка> }` отдельно | проходит |
| `related { anime { <полная> } } + chronology { <полная карточка> }` | **207 — отказ** |
| `related { anime { <полная> } manga { <полная> } } + chronology { id franchise }` | **210 — отказ** |

То есть **`related` и `chronology` в одном запросе не уживаются ни в каком виде** — даже когда у `chronology` просят два скалярных поля. Второй раздел на экране = второй запрос.

Отказ по сложности приходит как `errors[]` при HTTP 200, то есть `unwrapGraphqlResponse` превращает его в `{kind: 'api', status: 200}` с английским текстом сервера в `message`. До пользователя этот текст **не доходит**: `apiErrorMessage()` для `kind: 'api'` всегда отдаёт общее `i18n.errors.api` («Shikimori ответил ошибкой. Попробуйте ещё раз.»), а серверное `message` читается ровно в одном месте — `src/composables/use-rates.ts`, и только при `status === 422` (валидация записи). Так что экран связанных на отказе по сложности покажет общий русский текст, а конкретная причина останется только в `ApiError.message` — в логи она тоже не попадает (`http.ts` пишет лишь `kind` и `status`, docs/02).

### `Anime.franchise` / `Manga.franchise`
`String`, nullable. Слаг вида `fullmetal_alchemist`, `one_piece`, `detective_conan`, `pretty_cure`.

- **Слаг НЕ общий для аниме и манги одного произведения** (у аниме One Piece — `one_piece`, у манги-первоисточника — свой). Объединять типы по слагу нельзя; кросс-тип строится только на `related`.
- **`franchise: null` не означает «связей нет».** На топ-100 популярных: `franchise: null` у 4 тайтлов, и у 2 из них `related` непустой (`Kiseijuu: Sei no Kakuritsu`, `Darling in the FranXX`). То есть **гейт точки входа по непустому слагу спрятал бы живые связи примерно у 2%** — гейтить по `franchise` нельзя.

### `Anime.related` / `Manga.related` — `[Related!]`
```graphql
Related {
  id           # ID! — id СВЯЗИ, не тайтла; волатилен, в ключи и кэш не годится
  relationKind # RelationKindEnum!
  relationText # String! — приходит УЖЕ ПО-РУССКИ: «Адаптация», «Другая история»
  anime        # Anime — заполнено ровно одно из двух,
  manga        # Manga — второе null
}
```
`RelationKindEnum` (12 значений): `adaptation, alternative_setting, alternative_version, character, full_story, other, parent_story, prequel, sequel, side_story, spin_off, summary`.

- Порядок элементов **стабилен между запросами** (две подряд выдачи по FMA:B совпали поэлементно).
- Сам тайтл в `related` не входит.
- Кросс-тип в комплекте: у аниме в связях приходит манга-первоисточник и наоборот.
- **`relationText` сервера формулируется по-разному у аниме и манги для одного и того же `relationKind`** — если подписи должны быть единообразными, карта подписей заводится своя, а серверный текст остаётся в мете строки.

Объём (полная карточка обоих типов, замер 2026-08-10):

| Тайтл | `related` | Ответ |
|---|---|---|
| One Piece (21) | 92 | 57,2 КБ |
| Detective Conan (235) | 81 | 51,9 КБ |
| Mobile Suit Gundam (80) | 60 | 35,9 КБ |
| Fate/stay night (356) | 14 | 8,6 КБ |
| FMA: Brotherhood (5114) | 5 | 3,2 КБ |
| «Сен и Тихиро» (199), «Могила светлячков» (578) | 0 | 0,1 КБ |

Тайтлы **вообще без связей** — обычное дело, не ошибка: `franchise: null`, `related: []`, `chronology: []`.

### `Anime.chronology` / `Manga.chronology` — `[Anime!]` / `[Manga!]`
- **Только для одной сущности:** `animes(limit: 50) { chronology { … } }` отвечает ошибкой `Chronology can be fetched only for a single entity. Set limit: 1 in query arguments.` Батчить нельзя by design.
- **Включает сам тайтл** (FMA:B пришёл в собственной хронологии).
- Гомогенна по типу: манга-первоисточник в хронологию аниме не попадёт.
- Порядок пришёл по убыванию года (2011 → 2003), но сортировка сервером не документирована — полагаться на неё нельзя, `OrderEnum` сюда не применяется.
- **Склеивает франшизы через кроссоверы.** Замер: у `Detective Conan` (235) и `Precure` (603) хронологии **побайтово одинаковы — 158 элементов у обоих**, потому что кроссовер соединил два кластера. Разбираются они по слагу элемента: у Конана 84 своих / 73 чужих (`pretty_cure`) / 1 без слага; у Precure зеркально. То есть фильтр `chronology` по собственному слагу отсекает чужое точно и теряет **один** элемент из 158 — цена фильтра мала.

### `animes(franchise: String)` — третий путь
Аргумент существует и работает: `animes(franchise: "fullmetal_alchemist", limit: 50)` вернул 9 тайтлов, 939 B. По сравнению с `chronology`:

- **чище** — отдаёт ровно свой слаг, кроссовер не приносит;
- отдаёт **полную карточку и `userRate`**, батчится и пагинируется как обычный `animes()`;
- **но потолок `limit` = 50**, как у всех `animes()`: у `detective_conan` вернулось ровно 50 из 84 своих → большие франшизы требуют пагинации;
- **и не покрывает тайтлы с `franchise: null`** — для них остаётся только `related`.

### Эталонный запрос фазы 12 (аниме)
Ниже — запрос **в том виде, в каком его шлёт код** (`RELATED_ANIMES_QUERY`, `src/lib/api/graphql.ts`):
```graphql
query RelatedAnimes($ids: String) {
  animes(ids: $ids, limit: 1) {
    related {
      relationKind relationText
      anime { id name russian kind score status episodes episodesAired airedOn { year } poster { miniUrl mini2xUrl } userRate { id status } url }
      manga { id name russian kind score status volumes chapters airedOn { year } poster { miniUrl mini2xUrl } userRate { id status } url }
    }
  }
}
```
Глубина 5 (`animes → related → anime → airedOn → year`) — впритык к потолку, глубже нельзя. Сложность в пределах 190 (проверено на One Piece, 92 связи). Зеркальный запрос для манги — `mangas(ids:)` с теми же полями.

**Замеряли 2026-08-10 запрос на три поля шире:** у хоста просили ещё `id` и `franchise`, у связи — `Related.id`. Ни одно из трёх не читается кодом (`franchise` — потому что гейта точки входа по нему не будет, docs/06 Ф12-8; `Related.id` — id связи, волатилен), поэтому в коде их нет. Отправляемый запрос — строгое подмножество замеренного, то есть сложность может быть только меньше 190, и замер остаётся в силе.

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
Инкрементирует прогресс: у аниме — `episodes`, у манги и ранобэ — `chapters`. Подтверждено smoke владельца 2026-07-27 (чекбокс «`increment` для манги» ниже закрыт), contingency с `PATCH {chapters: progress+1}` не понадобился — «+1» остаётся на `increment`.

### Сервер сам переводит в `completed` (проверено 2026-07-29)
**Когда прогресс достигает общего числа серий, Shikimori ставит `status: "completed"` сам — отменить это запросом нельзя.** Проверено живым PATCH владельца на «Провожающая в последний путь Фрирен» (28 эп., прогресс 3, статус `watching`):

| Запрос | Статус в ответе |
|---|---|
| `PATCH { episodes: 28 }` | `completed` |
| `PATCH { episodes: 28, status: "watching" }` | `completed` |

То есть явный статус в том же теле авто-перевод **не** отменяет. Следствия:
- наше правило «в `completed` автоматически не переводим» (US-6) описывает только **наше** поведение: мы такой записи не делаем, но и помешать серверу не можем;
- inline-предложение «→ Просмотрено?» на аниме с известным числом серий недостижимо: к моменту ответа статус уже `completed`, а `maybeSuggest` требует активного статуса;
- строка после такой записи уходит из фильтра «Смотрю» — это подтверждённый сервером статус, а не наша самодеятельность. Чтобы это не выглядело как «тайтл молча пропал», смена статуса сервером показывается тостом (Ф7-20).

## REST v1 — добор постеров (Ф6-27)

**Зачем.** GraphQL для аниме с `rating: "rx"` возвращает `poster: null` — ссылки на картинку в ответе нет вовсе (проверено 2026-07-28 на id 1342, 48755, 50634). Сами файлы при этом публичны и открываются. Поэтому карточка без постера добирается через REST-индекс, и только потом падает на локальную заглушку (цепочка — docs/05).

```
GET {origin}/api/animes?ids=1342,48755,50634&limit=50
GET {origin}/api/mangas?ids=...&limit=50
GET {origin}/api/ranobe?ids=...&limit=50
→ [ { "id": 1342, "image": { "original": "/system/animes/original/1342.jpg?1711979744",
                             "preview": "...", "x96": "...", "x48": "..." }, ... }, ... ]
```

Три вещи, которые выяснены живыми запросами и стоят того, чтобы их не переоткрывать:

1. **`limit` обязателен.** Без него эндпоинт отдаёт **одну** запись независимо от длины списка `ids`.
2. **`/api/mangas?ids=` молча выбрасывает ранобэ.** Id 81669 не возвращается, хотя `/api/mangas/81669` и `/api/ranobe?ids=81669` его отдают. Поэтому для ранобэ — свой эндпоинт, а не общий с мангой.
3. **Тайтлы без картинки вообще** (анонсы) отвечают путём-плейсхолдером `/assets/globals/missing_*` — такие отсеиваются, иначе вместо нашей заглушки приедет чужая.

Пути в `image.*` относительные — склеиваются с origin из настроек (правило 4: домен только из конфига).

**Размеры `image.*`** (замеры живых файлов 2026-07-27): `x48` 48×75 (2,6–2,8 КБ), **`x96` 96×150 (7–9 КБ)**, `preview` 160×226 (9,4–21,9 КБ), `original` 225×318–355 (16–40 КБ). Берётся `x96`: его пропорция 1:1,5625 совпадает с боксом карточки 60×94, тогда как у `preview`/`original` она 1:1,41 и `object-fit: cover` срезал бы бока. Ретина-варианта подходящей пропорции в REST нет, поэтому у добранных постеров `srcset` не ставится.

## Профиль
```
GET {origin}/api/users/whoami
→ { "id": ..., "nickname": "...", "avatar": "<url>", "image": { ... }, ... }
```
Вызывается после логина; `id` обязателен для создания user_rates.

## Обработка ошибок API
| Код | Действие |
|---|---|
| 401 | **только в `authorizedRequest`** (`src/lib/api/auth.ts`): refresh токена → повтор 1 раз → при неудаче `clearAuth()` и logout-состояние. Через него идут **записи** (`rates.ts`); чтения (`graphql.ts`, `posters.ts`) зовут `apiRequest` напрямую и на 401 просто отдают `{kind: 'unauthorized'}` без refresh (то же — docs/04 §3, «Где применяется политика п.6») |
| 403 | не хватает scope — проверить, что при авторизации запрошен `user_rates`. Отдельной ветки в коде нет: маппится в `{kind: 'api', status: 403}` |
| 404 (user_rate) | запись удалили на сайте → убрать из UI, не фатал |
| 422 | валидация; единственный код, у которого `message` из тела ответа реально показывается пользователю (`use-rates.ts`) |
| 429 | `{kind: 'rate_limited'}` + backoff по правилам limiter (docs/02) — **единственный вид ошибки, который повторяется автоматически** |
| 5xx | `{kind: 'api', status}` и общий текст `i18n.errors.api` («Shikimori ответил ошибкой. Попробуйте ещё раз.») в состоянии ошибки экрана или в тосте. Отдельного текста «Shikimori недоступен» в `i18n.ts` нет, автоматического повтора для 5xx (в том числе для GET) в `http.ts` тоже: `retryOn429` управляет ровно повтором на 429. Повтор 5xx остаётся ручным — кнопка «Повторить» |

## Проверить при реализации (результат фиксировать здесь же: чекбокс + заметка)
- [x] Точные поля типа `Poster` — нужен URL маленького превью для списков (интроспекция)
  - Интроспекция 2026-07-23: 14 полей, все `String!` (список в «Результатах интроспекции» выше). Для карточки поиска — `miniUrl` (скачан живой файл: 60×94 px webp) + `mini2xUrl` для retina.
- [x] Поведение `userRate` в GraphQL с токеном и без
  - Частично: БЕЗ токена `userRate: null` подтверждено живым публичным запросом 2026-07-23. Под Bearer (ненулевой userRate для тайтла из списка) — ожидает ручной проверки владельца, команды в отчёте задачи Ф2-1.
  - Ненулевой `userRate` под Bearer закрывается тем же curl, что и аргумент `mylist` (см. чекбокс «Существует ли аргумент `mylist`…» ниже): один ответ владельца подтверждает и фильтрацию списка, и ненулевой `userRate`. Результат владельца: подтверждено 2026-07-23 (owner-verification фазы 3 — mylist под Bearer вернул ненулевой `userRate`).
- [x] Синтаксис множественного `kind` для ранобэ (`"light_novel,novel"`)
  - Подтверждено живым запросом 2026-07-23: `mangas(search: "overlord", kind: "light_novel,novel")` вернул light_novel-тайтлы; description скаляра `MangaKindString` явно описывает «List of values separated by comma» и `!` для негативного фильтра.
  - Негативный вариант для вкладки «Манга» (`kind: "!light_novel,!novel"`) подтверждён живым запросом 2026-07-24: на поиске «monogatari» light_novel/novel исчезли из выдачи (без фильтра — присутствуют). Поля Manga для карточки подтверждены интроспекцией 2026-07-24: `chapters`/`volumes: Int!`, `status: MangaStatusEnum` nullable (см. «Результаты интроспекции»).
- [x] Существует ли аргумент `mylist` у `animes`/`mangas` (для варианта А списков)
  - ДА (интроспекция 2026-07-23): `mylist: MylistString` у обоих запросов; значения = 6 статусов user_rate, тоже списком через запятую. Поведение под Bearer — проверить в фазе 3.
  - **Owner-verification фазы 3 (Bearer):** выбран вариант А (чтение списков через GraphQL `animes(mylist:)`, один запрос на страницу, без `user_id` в read-пути). Подтвердить фильтрацию по владельцу живым запросом:
    ```
    curl -s -X POST https://shikimori.io/api/graphql \
      -H 'Content-Type: application/json' -H 'User-Agent: <APP_NAME>' \
      -H 'Authorization: Bearer <живой access token>' \
      -d '{"query":"{ animes(mylist: \"watching\", limit: 5) { id name userRate { id status episodes score } } }"}'
    ```
    Ожидание (вариант А подтверждён): вернутся ТОЛЬКО тайтлы из «Смотрю», у каждого `userRate` ненулевой, `status=watching`. Результат владельца: ПОДТВЕРЖДЕНО 2026-07-23 — вариант А рабочий, `animes(mylist:)` под Bearer фильтрует по владельцу токена; расширение живёт на варианте А.
    Иначе (mylist под Bearer вернул чужие/все тайтлы или ошибку) → откат на вариант Б: REST `GET /api/v2/user_rates?user_id=<id>&target_type=Anime&status=watching&limit=30&page=1` + дозапрос карточек одним GraphQL по `ids`.
- [x] `mangas(mylist:)` под Bearer: фильтрация по владельцу и совместная работа `mylist` + `kind` (вариант А для списков манги/ранобэ, фаза 4)
  - Аргументы `mylist`/`kind` у `mangas` подтверждены интроспекцией (2026-07-23/24, см. «Результаты интроспекции»); под Bearer для `mangas` поведение не проверялось — фаза 3 проверяла только `animes(mylist:)`.
  - **Owner-verification фазы 4, GraphQL (Bearer).** Два запроса:
    ```
    # 1) mylist + kind вместе: ожидаются ТОЛЬКО мои тайтлы из «Читаю» и ТОЛЬКО ранобэ
    #    (kind = light_novel | novel), у каждого userRate ненулевой, status=watching
    curl -s -X POST https://shikimori.io/api/graphql \
      -H 'Content-Type: application/json' -H 'User-Agent: ShikiFAV' \
      -H 'Authorization: Bearer <живой access token>' \
      -d '{"query":"{ mangas(mylist: \"watching\", kind: \"light_novel,novel\", limit: 5) { id name kind userRate { id status chapters score } } }"}'

    # 2) контрольный, тот же mylist БЕЗ kind: по-прежнему только мои «Читаю»,
    #    но в выдаче манга и ранобэ вместе
    curl -s -X POST https://shikimori.io/api/graphql \
      -H 'Content-Type: application/json' -H 'User-Agent: ShikiFAV' \
      -H 'Authorization: Bearer <живой access token>' \
      -d '{"query":"{ mangas(mylist: \"watching\", limit: 5) { id name kind userRate { id status chapters score } } }"}'
    ```
    Если в «Читаю» нет ни одного ранобэ, запрос 1 вернёт пустой список — тогда повторить оба curl со статусом, где ранобэ точно есть (например `planned`).
    Результат: подтверждено функционально smoke-ом владельца 2026-07-27 («всё работает»): вкладки Манга/Ранобэ показывали только свои тайтлы с корректным разделением kind (расширение шлёт `mylist` + `kind` в одном запросе — см. `MYLIST_MANGAS_QUERY`). Формальные curl из пакета выше не прогонялись; при странностях в списках манги перепроверить ими.
- [x] Комбинация `mylist` + `status` под Bearer фильтрует по владельцу (календарь, фаза 7)
  - Отдельно каждый аргумент проверен: `mylist` под Bearer фильтрует по владельцу токена (фаза 3, чекбокс выше), `status: "ongoing"` работает публично (запросы 2026-07-28). Вместе под Bearer — нет.
  - **Owner-verification фазы 7 (Bearer).** Два запроса:
    ```
    # 1) целевой: ожидаются ТОЛЬКО мои тайтлы из «Смотрю»/«Пересматриваю» и ТОЛЬКО онгоинги
    #    (status=ongoing у каждого), userRate ненулевой
    curl -s -X POST https://shikimori.io/api/graphql \
      -H 'Content-Type: application/json' -H 'User-Agent: ShikiFAV' \
      -H 'Authorization: Bearer <живой access token>' \
      -d '{"query":"{ animes(mylist: \"watching,rewatching\", status: \"ongoing\", limit: 50) { id name status nextEpisodeAt episodes episodesAired userRate { id status episodes } } }"}'

    # 2) контрольный, тот же mylist БЕЗ status: по-прежнему только мои тайтлы,
    #    но в выдаче вместе с онгоингами есть released — значит фильтр из запроса 1 сработал,
    #    а не совпал с содержимым списка
    curl -s -X POST https://shikimori.io/api/graphql \
      -H 'Content-Type: application/json' -H 'User-Agent: ShikiFAV' \
      -H 'Authorization: Bearer <живой access token>' \
      -d '{"query":"{ animes(mylist: \"watching,rewatching\", limit: 50) { id name status userRate { id status } } }"}'
    ```
    Результат (владелец, 2026-07-28): **`status` под `mylist` не игнорируется** — тот же `mylist` без `status` вернул 2 тайтла, с `status: "ongoing"` — 0. Строк с чужим статусом или без `userRate` не было.
    **Список статусов через запятую подтверждён тем же прогоном:** по статусам поодиночке `watching` 1, `rewatching` 1, `planned` 2, `on_hold` 0 — то есть `"watching,rewatching"` вернул ровно объединение (2), а не первый статус из списка.
    **Закрыто 2026-07-29 owner-smoke фазы 7.** В прогоне 2026-07-28 не хватало одного: реальной строки календаря (`nextEpisodeAt` + `userRate` под Bearer) — единственный онгоинг аккаунта лежал в «Запланировано», а тот прогон его не запрашивал. Условие закрытия («первый же онгоинг в выдаче календаря») выполнено на smoke 2026-07-29: календарь на аккаунте владельца показал расписание живыми строками (docs/06, чекбокс owner-verification фазы 7).
  - **Contingency:** если `status` под `mylist` игнорируется (в ответе 1 есть released) → фильтровать по `status` клиентски в маппере календаря. Если `mylist` не принимает два статуса через запятую (ошибка или выдача только по первому) → два запроса (`watching` и `rewatching`) и слияние по `id`; оба идут через общий limiter, суммарно 2 запроса на открытие вкладки.
- [x] `increment` для манги: главы или что-то другое
  - Ожидает: живой Bearer + фаза 4 («+1» для манги/ранобэ).
  - **Owner-verification фазы 4, REST (Bearer).** Полный цикл на тестовой записи: создать → increment → удалить. Тайтл — любая манга НЕ из моих списков (её `id` можно взять из публичного поиска `mangas`, для REST — `Number(id)`):
    ```
    # 1) создать тестовую запись (ожидается 201; из тела сохранить "id" — это <rate_id>)
    curl -s -X POST https://shikimori.io/api/v2/user_rates \
      -H 'Content-Type: application/json' -H 'User-Agent: ShikiFAV' \
      -H 'Authorization: Bearer <живой access token>' \
      -d '{"user_rate":{"user_id":<мой id из whoami>,"target_id":<id манги>,"target_type":"Manga","status":"planned"}}'

    # 2) increment: в теле ответа chapters должен стать 1 (бампнулись именно главы,
    #    volumes остался 0); заодно проверить, что chapters/volumes/episodes/score
    #    присутствуют в теле и являются числами (не null/строки)
    curl -s -X POST https://shikimori.io/api/v2/user_rates/<rate_id>/increment \
      -H 'User-Agent: ShikiFAV' -H 'Authorization: Bearer <живой access token>'

    # 3) удалить тестовую запись (ожидается 204)
    curl -s -o /dev/null -w '%{http_code}\n' -X DELETE https://shikimori.io/api/v2/user_rates/<rate_id> \
      -H 'User-Agent: ShikiFAV' -H 'Authorization: Bearer <живой access token>'
    ```
    Результат: подтверждено функционально smoke-ом владельца 2026-07-27 («всё работает»): «+1 глава» в popup инкрементировал именно главы, значения совпадали с сайтом; реконсиляция UI по chapters из тела ответа отработала (NaN/undefined не наблюдалось) — форма тела increment для манги косвенно подтверждена. Формальный REST-цикл create→increment→delete не прогонялся; команды выше оставлены на случай перепроверки.
  - **Contingency (не понадобился):** если бы increment бампил НЕ chapters — «+1» для Manga делался бы через `PATCH /api/v2/user_rates/{rate_id}` с телом `{"user_rate":{"chapters":<progress+1>}}`. Итог: остаёмся на `increment`.
- [x] Форма REST-ответа write-операций (create / update / increment): присутствуют ли и non-null поля `score`, `episodes`, `chapters`, `volumes`, из которых собирается `RateState` (`src/lib/api/rates.ts`, `toRateState`)
  - `RestUserRate` типизирует их как non-null `number`, но проверен только GraphQL-тип `UserRate` (интроспекция 2026-07-23); форма REST v2 `user_rate` в ответе не подтверждена. Закрывается живой write-операцией владельца (PATCH/increment) — свериться, что тело ответа содержит все четыре поля числами.
  - Результат: подтверждено косвенно smoke фазы 3 (2026-07-23) — реконсиляция прогресса и оценки в UI идёт по полям тела ответа PATCH/increment (`RateState.episodes`/`score`), в smoke значения отображались корректно (NaN/undefined не наблюдалось). Прямую проверку тела для манги (chapters/volumes) повторить в фазе 4 вместе с чекбоксом «increment для манги» — команды в блоке owner-verification фазы 4 (REST) в том чекбоксе выше, результат вписать туда.
- [x] Что возвращает API после отзыва доступа в профиле (фаза 2): 401 (токен инвалидирован целиком) или 403 (только scope user_rates), и работает ли whoami — от результата зависит текст/поведение предупреждения при отказе записи (ленивое обнаружение, docs/04 §3)
  - Живая проверка владельца 2026-07-23: отзыв приложения в профиле → whoami и POST `/api/v2/user_rates` возвращают **401 `invalid_token`** (токен инвалидирован целиком, 403 не наблюдается); refresh (`/oauth/token` grant_type=refresh_token) → **400 `invalid_grant`**.
  - ВНИМАНИЕ: этот 401 виден только при `credentials: 'omit'` в fetch (http.ts). Без omit браузер прикладывает сессионную куку сайта (host_permissions на домен), сервер аутентифицирует запрос по ней в обход Bearer, и отзыв токена не детектится — отозванный токен «работает», пока жива сессия сайта.
- [x] Уходит ли кастомный User-Agent через fetch в текущем Chrome (иначе включить DNR-fallback)
  - НЕТ (Chrome 150, проверка владельца 2026-07-22): кастомный UA из fetch в MV3 SW подменяется на браузерный `Mozilla/5.0 ...` → включён DNR-fallback (permission `declarativeNetRequestWithHostAccess`, правило id=1 в `src/lib/api/user-agent-rule.ts`).
  - Как проверялось: временный дев-код в `entrypoints/background.ts` (`TEMP UA-check (task 6)`, удалён 2026-07-22 после подтверждения) отправлял один запрос, заголовки смотрелись в DevTools service worker'а → Network → Request Headers → `User-Agent`.
- [x] DNR-правило реально подменяет UA на APP_NAME
  - ДА (Chrome 150, проверка владельца 2026-07-22): в Request Headers боевого запроса к shikimori.io виден `User-Agent: ShikiFAV`. TEMP UA-check из `entrypoints/background.ts` удалён.
- [ ] DNR-правило НЕ трогает запросы самого сайта (после правки `excludedInitiatorDomains`, 2026-08-04)
  - Как проверять: открыть shikimori.io обычной вкладкой при установленной сборке, DevTools вкладки → Network → любой XHR страницы → Request Headers → `User-Agent` должен быть браузерным (`Mozilla/5.0 ...`), а не `ShikiFAV`. Заодно убедиться, что в DevTools service worker'а запросы расширения по-прежнему уходят с `ShikiFAV`.
- [x] Отвечает ли API на shikimori.io идентично shikimori.one, включая Bearer-авторизацию (иначе оставить в настройках только .one)
  - Bearer на .io подтверждён живым входом 2026-07-22 (token + whoami на .io, это дефолтный origin). GraphQL на .io подтверждён 2026-07-23 (интроспекция + публичный поиск animes/mangas). Прямое сравнение с .one не требуется: .one отдаёт 301 на .io и как API-origin непригоден (см. заметку «301 на shikimori.one» выше).
- [x] Поддержка PKCE сервером (детали в docs/04 §5)
  - См. docs/04 §5 — PKCE-only отвергнут (401 invalid_client), рабочая схема: confidential client + PKCE S256 поверх (2026-07-22).
- [x] Форма ответа whoami: поле `avatar` (маппинг в `avatarUrl`, src/lib/api/auth.ts) — подтверждено при первом живом входе 2026-07-22: ник и аватар корректно отображаются в popup
- [x] Содержимое `franchise` / `related` / `chronology` (фаза 12) — форма элементов, объёмы, потолки
  - Закрыто 2026-08-10 интроспекцией и живыми публичными запросами, разбор — в разделе «Франшизы и связанные тайтлы (фаза 12)» выше. Главное, чего не было в допущениях: **второй потолок сервера `max complexity 190`** (`related` и `chronology` в одном запросе не уживаются), **`chronology` не батчится** (`limit: 1` обязателен) и **склеивает франшизы через кроссоверы** (Конан и Precure — одна и та же выдача из 158 элементов), а **`franchise: null` не означает отсутствия связей** (2 случая на топ-100), поэтому гейт точки входа по слагу невозможен.
- [ ] `userRate` внутри `related`/`chronology` под Bearer (фаза 12) — приходит ли мой статус у связанных тайтлов
  - Публичный запрос даёт `userRate: null` у всех связанных, что не отличает «нет в списках» от «поле не работает вложенно». Проверяется тем же curl, что и остальные Bearer-чекбоксы:
    ```
    curl -s -X POST https://shikimori.io/api/graphql \
      -H 'Content-Type: application/json' -H 'User-Agent: ShikiFAV' \
      -H 'Authorization: Bearer <живой access token>' \
      -d '{"query":"{ animes(ids: \"<id тайтла, у которого связанный тайтл ЕСТЬ в моих списках>\", limit: 1) { related { relationKind anime { id name userRate { id status } } } } }"}'
    ```
    Ожидание: у связанного тайтла из моих списков `userRate` ненулевой. Иначе бейдж статуса на экране связанных требует отдельного дозапроса, и это меняет стоимость экрана на один запрос.
