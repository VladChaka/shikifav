# Политика конфиденциальности ShikiFav

Дата последнего изменения: 2026-07-30

ShikiFav — расширение для Chrome, которое даёт работать со списками аниме, манги и ранобэ на [Shikimori](https://shikimori.io) без открытия сайта.

## Коротко

**Расширение не собирает ваши данные.** У проекта нет ни сервера, ни аналитики, ни рекламы, ни сторонних сервисов. Всё, что расширение хранит, лежит в вашем браузере; всё, что оно отправляет, уходит на Shikimori — тот самый сайт, чьим аккаунтом вы пользуетесь.

## Что хранится в браузере

В `chrome.storage.local` — до тех пор, пока вы не выйдете или не удалите расширение:

- **токены доступа Shikimori** (access и refresh), полученные при входе через официальную авторизацию сайта;
- **профиль** — ник, идентификатор и адрес аватара, как их вернул Shikimori;
- **настройки** — тема, домен API, язык названий, стартовая вкладка и фильтры по умолчанию.

В `chrome.storage.session` — стирается при закрытии браузера:

- последние результаты поиска и последняя просмотренная страница списка (нужны, чтобы popup открывался мгновенно);
- последняя открытая вкладка и разовые передачи вида «открой поиск с этим запросом».

## Куда уходят запросы

Только на `shikimori.one` и `shikimori.io`: поиск, чтение ваших списков, изменение статусов, оценок и прогресса. Запросы подписываются вашим токеном; куки сайта при этом намеренно не отправляются.

Постеры и аватары загружает сам браузер напрямую с Shikimori.

Больше расширение не обращается никуда: ни к нашим серверам (их нет), ни к аналитике, ни к рекламным сетям, ни к любым третьим сторонам.

## Выделенный текст

Пункт контекстного меню «Найти … на Shikimori» берёт выделенный вами текст и подставляет его в поиск расширения. Это происходит **только** когда вы сами выбрали пункт меню. Текст не сохраняется и никуда не отправляется, кроме поискового запроса к Shikimori.

## Ссылки на пожертвования

Раздел «Поддержать» в настройках содержит только внешние ссылки. Расширение не принимает платежи, не запрашивает платёжные данные и не передаёт площадкам ничего о вас — переход по ссылке ничем не отличается от обычного открытия сайта.

## Как удалить данные

- **«Выйти»** в шапке — стирает токены и профиль;
- **«Очистить кэш»** в настройках — стирает сохранённые результаты поиска и списков;
- **удаление расширения** — Chrome удаляет всё его хранилище целиком.

Данные вашего аккаунта на самом Shikimori этим не затрагиваются: списки, оценки и прогресс живут на сайте, и удалять их нужно там.

## Разрешения

Каждое разрешение расширение просит ради конкретной функции:

| Разрешение | Зачем |
| --- | --- |
| `identity` | окно официальной авторизации Shikimori (OAuth) — другого способа войти нет |
| `storage` | хранить токены, настройки и кэш в вашем браузере |
| `declarativeNetRequestWithHostAccess` | подставлять в запросы к Shikimori обязательный заголовок User-Agent с именем приложения — этого требуют правила их API, а Chrome не даёт задать этот заголовок обычным способом |
| `contextMenus` | один пункт меню для поиска выделенного текста |
| доступ к `shikimori.one` и `shikimori.io` | там находится API, с которым работает расширение; сайт исторически менял домены, поэтому поддерживаются оба, и вы можете переключить его в настройках |

## Изменения политики

Если что-то из перечисленного изменится, этот документ будет обновлён вместе с версией расширения.

## Контакты

<!-- TODO(владелец): вписать адрес для связи до подачи в Chrome Web Store. -->
Вопросы по расширению и этой политике: **адрес будет указан здесь**.

---

# Privacy Policy (English summary)

Last updated: 2026-07-30

ShikiFav is a Chrome extension for managing your [Shikimori](https://shikimori.io) anime, manga and light-novel lists without opening the site.

**The extension collects nothing.** There is no server behind it, no analytics, no advertising and no third-party services.

**Stored in your browser only.** `chrome.storage.local` keeps your Shikimori access and refresh tokens, the profile Shikimori returns (nickname, id, avatar URL) and your settings. `chrome.storage.session`, cleared when the browser closes, keeps the last search results and list page so the popup opens instantly.

**Network requests go to `shikimori.one` and `shikimori.io` only** — searching, reading your lists, and updating statuses, scores and progress. Requests carry your token; site cookies are deliberately not sent. Posters and avatars are loaded by the browser directly from Shikimori.

**Selected text** is passed to the extension's own search only when you choose the context-menu item, and is not stored.

**The support section** contains outbound links only: no payments are processed and no payment details are requested.

**Removing data:** "Выйти" (log out) clears tokens and profile, "Очистить кэш" clears the cached lists, and uninstalling the extension removes its storage entirely. Data held by Shikimori itself is not affected.

**Permissions:** `identity` for the official Shikimori OAuth window; `storage` for tokens, settings and cache; `declarativeNetRequestWithHostAccess` to set the User-Agent header Shikimori's API requires, which Chrome does not allow a normal fetch to change; `contextMenus` for a single search item; host access to `shikimori.one` and `shikimori.io`, where the API lives.

Contact: <!-- TODO(owner): add before submitting --> to be provided.
