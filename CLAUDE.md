# CLAUDE.md — Shikimori Quick (Chrome-расширение)

## О проекте
Chrome-расширение (Manifest V3) для быстрой работы со списками Shikimori без открытия сайта: OAuth2-вход, поиск аниме/манги/ранобэ, добавление в списки, смена статусов, оценки, «+1 эпизод» и ввод номера серии, календарь онгоингов, контекстное меню, страница настроек с темой.

Начинался как личный проект одного пользователя. **С 2026-08-06 опубликован в Chrome Web Store** — ShikiFAV 1.0.0, издатель Chaka Labs, Item ID `bpjembchapdbgncmacpkbepfjghjdkan` ([карточка в магазине](https://chromewebstore.google.com/detail/shikifav/bpjembchapdbgncmacpkbepfjghjdkan)), фаза 9 закрыта. У расширения есть сторонние пользователи, до которых не дотянуться: непонятные состояния и молчаливые отказы стоят дороже, чем «владелец разберётся».

## Стек
- TypeScript (strict), Vue 3 (Composition API, `<script setup>`), **без UI-библиотек**
- Стили — SCSS (dev-зависимость `sass`), scoped в компонентах
- WXT (сборщик расширений на базе Vite) + `@wxt-dev/module-vue`
- pnpm, ESLint + Prettier, Vitest
- Каждая новая зависимость обосновывается: приоритет — скорость открытия popup и размер бандла (бюджеты в docs/05-ui.md)

## Команды
```bash
pnpm i          # установка зависимостей
pnpm dev        # dev-сборка + Chrome с расширением (HMR)
pnpm build      # production-сборка в .output/chrome-mv3
pnpm zip        # zip для установки/распространения
pnpm compile    # проверка типов (vue-tsc --noEmit)
pnpm test       # vitest
pnpm lint       # eslint
```
Ловушка окружения одна (подробности — README, раздел 8): `pnpm test` без `.env` падает на `APP_NAME is not configured`. Вторая, `spawn-sync` в `allowBuilds`, закрыта — `spawn-sync: false` лежит в отслеживаемом `pnpm-workspace.yaml` (сверено 2026-08-10).

## Структура
```
entrypoints/
  popup/            # Vue-приложение (основной UI)
  background.ts     # service worker: весь API, auth, rate limiter, context menu
  options/          # страница настроек
  search/           # полноэкранная страница поиска (фаза 5)
src/
  lib/api/          # http-клиент, GraphQL-запросы, user_rates, auth
  lib/messaging.ts  # типизированный протокол popup <-> background
  lib/storage.ts    # типизированная обёртка chrome.storage
  lib/config.ts     # origin, имя приложения, client_id/secret из env
  components/       # Vue-компоненты
  composables/      # состояние экранов: use-auth, use-search, use-lists, use-calendar, …
  styles/           # общие SCSS вне компонентов (foundation, badge, list)
  assets/           # ассеты, импортируемые из кода (poster-fallback.png)
docs/               # проектная документация — ЧИТАТЬ ПЕРЕД РАБОТОЙ
```

## Жёсткие правила (не нарушать)
1. **Все сетевые запросы — только из background** через `src/lib/api/http.ts`. Popup/options/search не вызывают fetch к Shikimori напрямую — только сообщения в background. Причина: единый rate limiter и единая точка refresh токена (docs/02-architecture.md, ADR-1). **Исключение ровно одно — отправка событий в GA4** (`src/lib/api/analytics.ts`, фаза 10): она идёт из background голым `fetch` мимо `http.ts` намеренно, иначе в Google уехали бы Bearer-токен и User-Agent приложения, а замеры тратили бы лимит Shikimori. «Только из background» на неё распространяется, «через `http.ts`» — нет; новые исключения не заводить.
2. **Лимиты API: 5 rps / 90 rpm.** Клиент держит запас: очередь не более 4 rps и 80 rpm. На 429 — backoff. Запросы в цикле без очереди запрещены.
3. **User-Agent** каждого запроса к API = имя OAuth-приложения из config (требование Shikimori, иначе бан IP). Проверить, что заголовок реально уходит; если Chrome не даёт — fallback через declarativeNetRequest (docs/03-shikimori-api.md).
4. **Origin только из `src/lib/config.ts`** (по умолчанию shikimori.io, переключается в настройках на shikimori.one). Домены сайта исторически менялись — никаких захардкоженных URL по коду.
5. **Чтение — GraphQL, запись — REST v2** (`/api/v2/user_rates`). HTML сайта не парсить.
6. **Секреты:** client_id/client_secret — только из `.env` (в .gitignore), токены — только в `chrome.storage.local`. Токены и secret никогда не попадают в логи и сообщения об ошибках.
7. **Permissions по минимуму:** `identity`, `storage`, host_permissions на оба домена Shikimori **плюс `https://www.google-analytics.com/*`** (фаза 10, отправка анонимных событий; единственный не-Shikimori хост, обоснование для магазина — docs/07). Итого в собранном манифесте три host_permissions — сверено с `.output/chrome-mv3/manifest.json` 2026-08-10. `contextMenus` добавить только в фазе 5; `declarativeNetRequest` — только если понадобился fallback для User-Agent.

## Рабочий процесс
1. Работа идёт по фазам из `docs/06-roadmap.md` строго по порядку. Фаза закрыта = все её чекбоксы + Definition of Done + ручной smoke-чеклист.
2. Перед реализацией фичи прочитать соответствующие разделы docs/ (product → architecture → api/auth → ui).
3. В docs/03-shikimori-api.md есть блок «Проверить при реализации» — все допущения оттуда проверяются интроспекцией/тестовым запросом ДО использования, результат фиксируется в том же файле (отметить чекбокс + короткая заметка).
4. Не выдумывать поля и аргументы API: точные имена GraphQL-полей брать интроспекцией (сниппет в docs/03).
5. После изменений `pnpm compile && pnpm lint && pnpm test` должны быть зелёными.
6. Актуальные API внешних библиотек (WXT, Vue, Vitest, sass и др.) сверять через context7 MCP (`resolve-library-id` → `get-library-docs`), а не по памяти — это касается и всех агентов.
7. **Правки внешнего вида — сначала Claude Design, потом код.** Источник правды по UI — проект «Shikimori Quick UI» на claude.ai/design (карточки foundations/components/screens; доступ через DesignSync у оркестратора). Новый вид сперва фиксируется/утверждается в карточке дизайна, затем переносится в код. Если правка по прямому запросу владельца пошла код-first — сразу после неё актуализировать затронутые карточки, расхождение кода и дизайна не оставлять.

## Стиль кода
- TS strict, `any` запрещён; общие типы API — в `src/lib/api/types.ts`
- Vue: `<script setup lang="ts">`; состояние через composables, Pinia не подключать (избыточно для popup)
- Файлы kebab-case, компоненты PascalCase
- Идентификаторы и комментарии в коде — English; тексты UI — русские; общение с пользователем — по-русски; commit messages — English, conventional commits
- Общение, отчёты агентов и ревью — коротко и по факту: без воды, без пересказа очевидного и без повторения постановки задачи

## Навигация по docs/
| Файл | Что внутри |
|---|---|
| docs/01-product.md | цели, не-цели, user stories с критериями приёмки |
| docs/02-architecture.md | компоненты, ADR-1, протокол сообщений, storage, limiter, ошибки |
| docs/03-shikimori-api.md | GraphQL и REST v2, заголовки, лимиты, чек-лист проверок |
| docs/04-auth.md | регистрация приложения, OAuth-флоу, refresh, PKCE, безопасность |
| docs/05-ui.md | экраны, состояния, перфоманс-бюджеты |
| docs/06-roadmap.md | фазы с DoD и smoke-чеклистами; бэклог |
| docs/07-store-listing.md | листинг Chrome Web Store: single purpose, обоснования permissions, раскрытие данных, скриншоты |
| docs/08-submission-runbook.md | порядок подачи в магазин по шагам: что за чем, чем проверяется, что делать при отказе |
| PRIVACY.md (в корне) | политика конфиденциальности, публикуется по внешнему адресу для магазина |
