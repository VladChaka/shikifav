# 04 — OAuth2 в расширении

Авторизация на Shikimori — только OAuth2 (authorization code flow). Эндпоинты: `{origin}/oauth/authorize` и `{origin}/oauth/token`. Access-токен живёт 86400 с (сутки), обновляется refresh-токеном.

## 1. Регистрация приложения (ручной шаг, делает владелец)
1. Залогиниться на Shikimori → открыть `{origin}/oauth/applications` → создать приложение.
2. **Имя** — выбрать и записать: оно же обязано быть в User-Agent (`WXT_SHIKI_APP_NAME`).
3. **Redirect URI** — значение `chrome.identity.getRedirectURL()`, вид: `https://<EXTENSION_ID>.chromiumapp.org/`.
4. Полученные client_id и client_secret положить в `.env` (файл в .gitignore):
```
WXT_SHIKI_APP_NAME="..."
WXT_SHIKI_CLIENT_ID="..."
WXT_SHIKI_CLIENT_SECRET="..."
```
В репозитории держать `.env.example` с пустыми значениями.

### Стабильный EXTENSION_ID
У unpacked-расширения ID детерминирован от абсолютного пути папки — на одной машине стабилен, пока проект не переносили. Порядок в фазе 1: собрать → загрузить → в консоли background выполнить `chrome.identity.getRedirectURL()` → вписать результат в настройки приложения на сайте. Опционально (фаза 6): добавить `key` в manifest, чтобы ID был стабилен всегда и везде.

**Результат (2026-07-23):** `key` добавлен в манифест production-сборок (`pnpm build`/`pnpm zip`, см. wxt.config.ts; приватный ключ — `.keys/shikifav-key.pem`, в git не попадает). Prod extension ID = `ilcnkoocagmcjikbelobkiflaplolbak`, redirect URI = `https://ilcnkoocagmcjikbelobkiflaplolbak.chromiumapp.org/`. Dev-сборка (`pnpm dev`) ключ не получает — её ID `gakfmcmfpajejjdpdckpgeihgpneajpj` без изменений, обе версии могут стоять в Chrome одновременно. Прежний path-derived prod-ID `bmndfomfgheoloklpjlldgmicdlmgmda` больше не актуален.

**Этот ID переживёт публикацию только по случайности — рассчитывать на это нельзя (2026-07-30).** У расширения в Chrome Web Store ключ, а значит и ID, выдаёт магазин при первой загрузке; документированный порядок обратный нашему — сначала загрузить пакет черновиком, забрать публичный ключ во вкладке Package и уже его вписать в манифест. Пока это не сделано, `redirect_uri` опубликованной версии не совпадёт с зарегистрированным, и `launchWebAuthFlow` вернёт ошибку у **каждого** пользователя. Полный порядок действий — docs/06, фаза 9, раздел «ID расширения: наш порядок обратный».

## 2. Поток входа (выполняется в background)
```ts
// src/lib/api/auth.ts — референсная реализация
export async function login(): Promise<User> {
  const redirectUri = chrome.identity.getRedirectURL();
  const authUrl =
    `${origin}/oauth/authorize?` +
    new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'user_rates',
    });

  const resultUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl,
    interactive: true,
  });
  const code = new URL(resultUrl!).searchParams.get('code');
  if (!code) throw new Error('No authorization code in redirect');

  const tokens = await exchangeCode(code, redirectUri);
  await saveTokens(tokens);
  const user = await whoami();      // GET /api/users/whoami (Bearer)
  await saveUser(user);
  return user;
}
```

### Обмен кода на токены
```
POST {origin}/oauth/token
Content-Type: application/x-www-form-urlencoded
User-Agent: <APP_NAME>

grant_type=authorization_code&client_id=...&client_secret=...&code=...&redirect_uri=...
```
Ответ:
```json
{
  "access_token": "...",
  "token_type": "Bearer",
  "expires_in": 86400,
  "refresh_token": "...",
  "scope": "user_rates",
  "created_at": 1719830400
}
```
Сохранение: `expiresAt = (created_at ?? Math.floor(Date.now()/1000)) + expires_in - 60`, в миллисекундах.

## 3. Refresh
```
POST {origin}/oauth/token
Content-Type: application/x-www-form-urlencoded
User-Agent: <APP_NAME>

grant_type=refresh_token&client_id=...&client_secret=...&refresh_token=...
```
Правила `ensureToken()` (вызывается http-клиентом перед каждым запросом):
1. Прочитать auth из storage (не из памяти — SW мог перезапуститься).
2. Если `Date.now() < expiresAt` — вернуть текущий accessToken.
3. Иначе refresh **single-flight**: параллельные вызовы ждут один общий промис; непосредственно перед сетевым запросом ещё раз перечитать storage — другой контекст мог уже обновить.
4. Ответ может содержать **новый refresh_token** — всегда сохранять пришедший.
5. Ошибка refresh (`invalid_grant`, 400/401) → очистить auth → состояние `anonymous`. Не зацикливаться, не ретраить refresh автоматически.
6. Если запрос API вернул 401 при «валидном по времени» токене (отозван на сайте) → один принудительный refresh → повтор запроса 1 раз → при неудаче п.5.

### Где применяется политика п.6 (зафиксировано по итогам перф-аудита Ф6-12)
Политика «401 → forceRefresh → один повтор → clearAuth» живёт в `authorizedRequest()` (`src/lib/api/auth.ts`), и через него идут **только записи** — REST v2 `user_rates` (create / update / delete / increment). **Чтения (GraphQL) вызывают `apiRequest()` напрямую**, то есть на 401 повтора не делают: при отозванном токене чтение сразу отдаёт `unauthorized`, а `auth` в storage остаётся (состояние станет `anonymous` только после следующей записи или после ближайшего refresh по истечении срока).

Обновление токена по времени чтения при этом не теряют: `apiRequest` берёт токен у `ensureToken()`, который сам делает refresh, когда `expiresAt` прошёл. Разница только в случае «токен валиден по времени, но отозван на сайте».

Это согласуется с ленивым обнаружением отзыва (подраздел ниже): пользователь узнаёт об отзыве по действию, а не по фоновой валидации; чтение показывает обычную ошибку `unauthorized` («Сессия истекла. Войдите заново.») с кнопкой «Повторить». Пункт записан явно, чтобы асимметрия чтение/запись не читалась как недосмотр: перевод чтений на `authorizedRequest` сознательно не сделан, и трогать это можно только вместе с решением по ленивому обнаружению.

### Отзыв доступа: ленивое обнаружение (решение владельца, 2026-07-23)
Расширение не проверяет сессию проактивно: открытие popup не делает запросов к API ради валидации токена (проактивная проверка из коммита a89bab4 откачена в e2bb402). Отзыв доступа на сайте всплывает при фактическом запросе — прежде всего при записи user_rate (фаза 2): действие падает, UI показывает предупреждение «нет доступа на редактирование» — только после попытки редактирования, не заранее. Политика пп.5–6 не меняется — она просто срабатывает лениво, при действиях.

## 4. Logout
Очистить `auth` в storage (и кэш в storage.session). Опционально: `POST {origin}/oauth/revoke` с токеном — проверить поддержку, не блокер.

## 5. client_secret в бандле — осознанный компромисс
Секрет неизбежно попадает в собранный код расширения. Для личного некоммерческого проекта риск приемлем: максимум — кто-то сможет представляться нашим приложением; токены пользователя при этом не утекают. Смягчение:
- [x] **Проверить PKCE в фазе 1:** добавить `code_challenge` + `code_challenge_method=S256` в authorize-URL и `code_verifier` в token-запрос БЕЗ client_secret. Если сервер принимает (движок Doorkeeper это умеет, вопрос — включено ли) → перейти на PKCE и убрать secret из бандла. Результат зафиксировать здесь.
  - **Вердикт живой пробы (2026-07-22): PKCE-only (public client) отвергнут.** Authorize с `code_challenge` прошёл, но `POST /oauth/token` без client_secret → 401 `invalid_client` (Www-Authenticate: «no client authentication included»). Doorkeeper Shikimori требует аутентификацию клиента. Принят гибрид: confidential client — `client_id` + `client_secret` во всех token-запросах (exchange и refresh) + PKCE S256 поверх как защита от перехвата кода. Флаг `PKCE_ENABLED` в `src/lib/api/auth.ts` включает только PKCE-слой (`false` отключает challenge/verifier, секрет не флагуется). Secret остаётся в бандле — принятое ограничение личного проекта, см. начало этого раздела.
- Репозиторий с реальным `.env` не публиковать; в публичной версии — только `.env.example`.

### Публикация отменяет предпосылку этого компромисса (2026-07-29)
Формулировка выше — «для личного некоммерческого проекта риск приемлем» — держалась на том, что сборку никто не раздаёт. С решением публиковать расширение в Chrome Web Store (docs/01) секрет становится доступен любому, кто скачал расширение из магазина. Спрятать его нельзя: обфускацию или шифрование расширение обязано развернуть само, а значит развернёт и читающий. Прокси-сервер, который держал бы секрет, противоречит ADR-1 и видел бы токены пользователей — для расширения, которое сейчас не собирает ничего, это ухудшение приватности.

Остаётся два пути, и только первый убирает секрет по-настоящему: попросить Shikimori разрешить публичные клиенты (PKCE без секрета) или завести отдельное OAuth-приложение под магазинную сборку, считая его секрет публично известным. Разбор и порядок действий — docs/06, фаза 9.

### Черновик запроса в Shikimori (готов к отправке владельцем)

Куда: issue в репозитории Shikimori (проект открытый) либо их канал обратной связи. Отправляет владелец — от его аккаунта, с его контактом.

```text
Заголовок: Поддержка public client (PKCE без client_secret) для OAuth-приложений

Здравствуйте!

Пишу про OAuth: сейчас /oauth/token требует client_secret, и это делает
невозможным честную интеграцию для клиентов, которые физически не могут
хранить секрет, — браузерных расширений и мобильных приложений.

Что проверено на живом API (приложение «ShikiFav», id 2175):

1. /oauth/authorize с code_challenge + code_challenge_method=S256 проходит
   нормально — PKCE на стороне authorize работает.
2. POST /oauth/token с code_verifier, но БЕЗ client_secret отвечает
   401 invalid_client, заголовок WWW-Authenticate: "no client authentication
   included". То есть аутентификация клиента обязательна.

Просьба: разрешить помечать OAuth-приложение как публичное
(non-confidential), чтобы для него /oauth/token принимал пару
code + code_verifier без client_secret. Если под капотом Doorkeeper, это
поле confidential у модели Application — то есть галочка в форме создания
приложения, а не новая логика.

Почему это важно: расширение распространяется через Chrome Web Store,
и client_secret внутри бандла доступен любому, кто его скачал. Спрятать
секрет в клиентском коде нельзя в принципе. RFC 8252 и OAuth 2.1 для
публичных клиентов и предписывают PKCE вместо секрета именно поэтому.

Пока такой возможности нет, приходится держать секрет в сборке — что
неправильно и по отношению к вашему API: скомпрометированный секрет
означает, что кто-то может представляться моим приложением.

Готов протестировать на своём приложении, как только появится флаг, и
прислать результат. Если подскажете, где в коде это включается, готов
оформить PR.

Спасибо за API и за то, что он открытый.
```

Что важно **не** обещать в переписке: сроков публикации расширения, зависящих от их ответа, и того, что расширение не выйдет без PKCE. Публикация возможна и с отдельным приложением под магазинную сборку — этот запрос улучшает решение, а не разблокирует его.

## 6. Требования безопасности
- Токены только в `chrome.storage.local`; не в localStorage, не в логах, не в текстах ошибок, не в сообщениях messaging (popup получает только `{status, user}`).
- Вход только через `launchWebAuthFlow`; никаких встроенных форм логина Shikimori внутри расширения.
- Минимальный scope: только `user_rates`.
- При ошибках сериализовать в лог только `kind`/`status`, без заголовков запроса.
