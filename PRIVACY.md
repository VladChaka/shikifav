# Политика конфиденциальности ShikiFAV

Дата последнего изменения: 2026-08-10

ShikiFAV — расширение для Chrome, которое даёт работать со списками аниме, манги и ранобэ на [Shikimori](https://shikimori.io) без открытия сайта.

## Коротко

**У расширения нет своего сервера и нет рекламы.** Списки, оценки и прогресс остаются на Shikimori, а токены доступа, профиль и настройки лежат в хранилище вашего браузера.

Совсем без данных о вас расширение при этом не обходится, и это не скрывается: оно хранит токены доступа и профиль Shikimori (ник, идентификатор, адрес аватара), читает выделенный вами текст — только когда вы сами выбрали пункт контекстного меню, — и отправляет обезличенные события об использовании функций, пока включена анонимная статистика. Что именно, куда и на какой срок — в разделах ниже.

Про **анонимную статистику использования** отдельно: расширение сообщает, какими функциями пользуются, чтобы понимать, что развивать. В ней нет ни вашего аккаунта, ни названий тайтлов, ни текстов поисковых запросов — полный список ниже, в разделе «Анонимная статистика». Она **включена по умолчанию и выключается одним переключателем** в «Настройки → Аккаунт и данные → Анонимная статистика».

## Что хранится в браузере

В `chrome.storage.local` — до тех пор, пока вы не выйдете или не удалите расширение:

- **токены доступа Shikimori** (access и refresh), полученные при входе через официальную авторизацию сайта;
- **профиль** — ник, идентификатор и адрес аватара, как их вернул Shikimori;
- **настройки** — тема, домен API, язык названий, стартовая вкладка и фильтры по умолчанию;
- **случайный идентификатор установки** — только пока включена анонимная статистика (см. её раздел ниже).

В `chrome.storage.session` — стирается при закрытии браузера (всё это нужно, чтобы popup открывался мгновенно):

- последний поисковый запрос вместе с его результатами;
- последняя просмотренная страница «Моих списков» — строки вашего списка с их статусами, оценками и прогрессом;
- последний загруженный календарь онгоингов — тоже строки вашего списка, с названиями и прогрессом по сериям;
- последняя открытая вкладка popup;
- разовые передачи между окнами расширения — «открой поиск с этим запросом» и «открой настройки на этом разделе»; каждая стирается сразу после того, как её прочитали.

## Куда уходят запросы

Только на `shikimori.one` и `shikimori.io`: поиск, чтение ваших списков и связанных тайтлов, изменение статусов, оценок и прогресса. Запросы подписываются вашим токеном; куки сайта при этом намеренно не отправляются.

Постеры и аватары загружает сам браузер напрямую с Shikimori.

Второй и последний адресат — `www.google-analytics.com`, и только пока включена анонимная статистика (см. следующий раздел). Больше расширение не обращается никуда: ни к нашим серверам (их нет), ни к рекламным сетям, ни к любым другим третьим сторонам.

## Анонимная статистика

Чтобы понимать, какими функциями пользуются, расширение отправляет обезличенные события в Google Analytics 4. Настройка включена по умолчанию; выключить — «Настройки → Аккаунт и данные → Анонимная статистика». В выключенном состоянии не отправляется ни одного запроса.

**Что отправляется:**

- открытие расширения и на какой вкладке оно открылось — поиск, списки или календарь;
- факт поиска и по какому каталогу — аниме, манга или ранобэ;
- добавление тайтла в список: тип (аниме или манга) и выбранный статус;
- изменение записи: какой именно элемент управления использован — статус, оценка или прогресс;
- отметка серии: кнопкой «+1» или вводом номера;
- удаление записи из списка — только факт, без указания тайтла;
- открытие календаря онгоингов;
- открытие экрана связанных тайтлов и тип тайтла, от которого он открыт (аниме или манга); название, идентификатор и число связей не передаются;
- использование пункта контекстного меню — только факт; выделенный текст не передаётся;
- изменение настройки: какая именно настройка изменена. Значение передаётся только для темы и домена API; для остальных — лишь факт изменения. Переключение самой статистики не сообщается;
- ошибки обращения к Shikimori: вид ошибки (нет сети, нет доступа, превышен лимит, ошибка сервера) и HTTP-код, без текстов и адресов;
- версия расширения;
- случайный идентификатор установки — он создаётся при первом событии, не связан с вашим аккаунтом Shikimori и **удаляется в тот момент, когда вы выключаете статистику**.

**Что не отправляется никогда:** тексты поисковых запросов, названия и идентификаторы тайтлов, ваши оценки как числа, ник, идентификатор и аватар аккаунта, токены, содержимое списков, выделенный на странице текст.

Получатель данных — Google (Google Analytics 4). Отправка идёт из расширения напрямую, без промежуточных серверов; запросы к Google не содержат вашего токена Shikimori.

Как и любой сетевой запрос, обращение к Google Analytics уходит с вашего IP-адреса. Расширение его не читает и не хранит, но Google определяет по нему примерную страну и регион. Выключение статистики прекращает и это.

## Выделенный текст

Пункт контекстного меню «Найти … на Shikimori» берёт выделенный вами текст и подставляет его в поиск расширения. Это происходит **только** когда вы сами выбрали пункт меню. Текст уходит поисковым запросом к Shikimori и вместе с результатами сохраняется в хранилище сессии браузера до его закрытия — стереть раньше можно кнопкой «Очистить кэш» в настройках. Никуда, кроме Shikimori, он не отправляется.

## Ссылки на пожертвования

Раздел «Поддержать» в настройках содержит только внешние ссылки. Расширение не принимает платежи, не запрашивает платёжные данные и не передаёт площадкам ничего о вас — переход по ссылке ничем не отличается от обычного открытия сайта.

## Как удалить данные

- **«Выйти»** в шапке — стирает токены и профиль;
- **«Очистить кэш»** в настройках — стирает сохранённые результаты поиска и списков;
- **выключение анонимной статистики** — прекращает отправку и удаляет случайный идентификатор установки;
- **удаление расширения** — Chrome удаляет всё его хранилище целиком.

Данные вашего аккаунта на самом Shikimori этим не затрагиваются: списки, оценки и прогресс живут на сайте, и удалять их нужно там.

## Разрешения

Каждое разрешение расширение просит ради конкретной функции:

| Разрешение                                | Зачем                                                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `identity`                                | окно официальной авторизации Shikimori (OAuth) — другого способа войти нет                                                                                                      |
| `storage`                                 | хранить токены, настройки и кэш в вашем браузере                                                                                                                                |
| `declarativeNetRequestWithHostAccess`     | подставлять в запросы к Shikimori обязательный заголовок User-Agent с именем приложения — этого требуют правила их API, а Chrome не даёт задать этот заголовок обычным способом |
| `contextMenus`                            | один пункт меню для поиска выделенного текста                                                                                                                                   |
| доступ к `shikimori.one` и `shikimori.io` | там находится API, с которым работает расширение; сайт исторически менял домены, поэтому поддерживаются оба, и вы можете переключить его в настройках                           |
| доступ к `www.google-analytics.com`       | отправка анонимной статистики; при выключенной статистике к этому адресу не уходит ни одного запроса                                                                            |

## Изменения политики

Если что-то из перечисленного изменится, этот документ будет обновлён вместе с версией расширения.

## Контакты

Вопросы по расширению и этой политике: **support@chakalabs.com**.

Актуальная версия этой политики опубликована по адресу <https://shikifav.chakalabs.com/> — на него же ссылается карточка расширения в Chrome Web Store.

---

# Privacy Policy (English summary)

Last updated: 2026-08-10

ShikiFAV is a Chrome extension for managing your [Shikimori](https://shikimori.io) anime, manga and light-novel lists without opening the site.

**There is no server behind the extension and no ads.** Your lists, scores and progress stay on Shikimori; access tokens, your profile and your settings stay in your browser's storage.

It does handle data about you, and this is not hidden: it stores your Shikimori access tokens and profile (nickname, id, avatar URL), it reads the text you selected — only when you pick the context-menu item yourself — and it sends anonymous usage events while the statistics below are on. What exactly, where to and for how long is in the sections that follow.

**Anonymous usage statistics.** The extension reports which features are used — which tab it opened on, that a search happened and over which catalogue, that a title was added, with what type (anime/manga) and status, which control was used to edit an entry, whether an episode was marked with the «+1» button or typed in, that an entry was removed, that the calendar or the context-menu item was used, that the related-titles screen was opened and from which type of title (anime/manga, never its name, id or number of links), which setting was changed (with the chosen value only for the theme and the API domain; toggling the statistics itself is never reported), and the kind (no network, no access, rate limit, server error) and HTTP status of a failed request — plus the extension version and a random per-install identifier. **Never sent:** search queries, title names or ids, your scores as numbers, your nickname, id or avatar, tokens, list contents, selected text. The recipient is Google (Google Analytics 4). It is **on by default and switched off** in Settings → «Аккаунт и данные» → «Анонимная статистика»; switching it off stops every request and deletes the random identifier.

**Stored in your browser.** `chrome.storage.local` keeps your Shikimori access and refresh tokens, the profile Shikimori returns (nickname, id, avatar URL), your settings and — only while the statistics are on — the random per-install identifier. `chrome.storage.session`, cleared when the browser closes, keeps — so that the popup opens instantly — the last search query with its results, the last viewed page of «Мои списки» and the last loaded ongoings calendar (both are rows of your own list, with their statuses, scores and progress), the last opened popup tab, and the one-shot handovers between the extension's windows («open search with this query», «open settings on this section»), each deleted as soon as it is read.

**Network requests go to `shikimori.one` and `shikimori.io`** — searching, reading your lists and a title's related entries, and updating statuses, scores and progress. Requests carry your token; site cookies are deliberately not sent. Posters and avatars are loaded by the browser directly from Shikimori. The only other host is `www.google-analytics.com`, and only while the statistics above are on; those requests never carry your token.

**Selected text** is passed to the extension's own search only when you choose the context-menu item. It is sent to Shikimori as a search query and cached with the results in `chrome.storage.session` until the browser closes (or until you press «Очистить кэш»); it goes nowhere else. Like any network request, the calls to Google Analytics carry your IP address: the extension neither reads nor stores it, but Google derives an approximate country and region from it, and switching the statistics off stops that too.

**The support section** contains outbound links only: no payments are processed and no payment details are requested.

**Removing data:** "Выйти" (log out) clears tokens and profile, "Очистить кэш" clears the cached lists, switching the statistics off deletes the random identifier, and uninstalling the extension removes its storage entirely. Data held by Shikimori itself is not affected.

**Permissions:** `identity` for the official Shikimori OAuth window; `storage` for tokens, settings and cache; `declarativeNetRequestWithHostAccess` to set the User-Agent header Shikimori's API requires, which Chrome does not allow a normal fetch to change; `contextMenus` for a single search item; host access to `shikimori.one` and `shikimori.io`, where the API lives, and to `www.google-analytics.com` for the anonymous statistics.

Contact: **support@chakalabs.com**. The current version of this policy is published at <https://shikifav.chakalabs.com/>, the address the Chrome Web Store listing points at.
