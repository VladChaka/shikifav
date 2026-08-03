# Политика конфиденциальности ShikiFav

Дата последнего изменения: 2026-07-31

ShikiFav — расширение для Chrome, которое даёт работать со списками аниме, манги и ранобэ на [Shikimori](https://shikimori.io) без открытия сайта.

## Коротко

**Расширение не собирает ваши личные данные и не показывает рекламу.** У проекта нет своего сервера: списки, оценки и прогресс остаются на Shikimori, а токены и настройки — в вашем браузере.

Единственное исключение — **анонимная статистика использования**: расширение сообщает, какими функциями пользуются, чтобы понимать, что развивать. В ней нет ни вашего аккаунта, ни названий тайтлов, ни текстов поисковых запросов — полный список ниже, в разделе «Анонимная статистика». Она **включена по умолчанию и выключается одним переключателем** в «Настройки → Аккаунт и данные → Анонимная статистика».

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
- использование пункта контекстного меню — только факт; выделенный текст не передаётся;
- изменение настройки: какая именно настройка изменена. Значение передаётся только для темы и домена API; для остальных — лишь факт изменения. Переключение самой статистики не сообщается;
- ошибки обращения к Shikimori: вид ошибки (нет сети, нет доступа, превышен лимит) и HTTP-код, без текстов и адресов;
- версия расширения;
- случайный идентификатор установки — он создаётся при первом событии, не связан с вашим аккаунтом Shikimori и **удаляется в тот момент, когда вы выключаете статистику**.

**Что не отправляется никогда:** тексты поисковых запросов, названия и идентификаторы тайтлов, ваши оценки как числа, ник, идентификатор и аватар аккаунта, токены, содержимое списков, выделенный на странице текст, IP-адрес в качестве идентификатора.

Получатель данных — Google (Google Analytics 4). Отправка идёт из расширения напрямую, без промежуточных серверов; запросы к Google не содержат вашего токена Shikimori.

## Выделенный текст

Пункт контекстного меню «Найти … на Shikimori» берёт выделенный вами текст и подставляет его в поиск расширения. Это происходит **только** когда вы сами выбрали пункт меню. Текст не сохраняется и никуда не отправляется, кроме поискового запроса к Shikimori.

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

Last updated: 2026-07-31

ShikiFav is a Chrome extension for managing your [Shikimori](https://shikimori.io) anime, manga and light-novel lists without opening the site.

**The extension collects no personal data and shows no ads.** There is no server behind it: your lists, scores and progress stay on Shikimori, tokens and settings stay in your browser.

**Anonymous usage statistics** are the one exception. The extension reports which features are used — which tab it opened on, that a search happened and over which catalogue, that a title was added and with what status, which control was used to edit an entry, whether an episode was marked with the «+1» button or typed in, that an entry was removed, that the calendar or the context-menu item was used, which setting was changed, and the kind and HTTP status of a failed request — plus the extension version and a random per-install identifier. **Never sent:** search queries, title names or ids, your scores as numbers, your nickname, id or avatar, tokens, list contents, selected text. The recipient is Google (Google Analytics 4). It is **on by default and switched off** in Settings → «Аккаунт и данные» → «Анонимная статистика»; switching it off stops every request and deletes the random identifier.

**Stored in your browser only.** `chrome.storage.local` keeps your Shikimori access and refresh tokens, the profile Shikimori returns (nickname, id, avatar URL) and your settings. `chrome.storage.session`, cleared when the browser closes, keeps the last search results and list page so the popup opens instantly.

**Network requests go to `shikimori.one` and `shikimori.io`** — searching, reading your lists, and updating statuses, scores and progress. Requests carry your token; site cookies are deliberately not sent. Posters and avatars are loaded by the browser directly from Shikimori. The only other host is `www.google-analytics.com`, and only while the statistics above are on; those requests never carry your token.

**Selected text** is passed to the extension's own search only when you choose the context-menu item, and is not stored.

**The support section** contains outbound links only: no payments are processed and no payment details are requested.

**Removing data:** "Выйти" (log out) clears tokens and profile, "Очистить кэш" clears the cached lists, switching the statistics off deletes the random identifier, and uninstalling the extension removes its storage entirely. Data held by Shikimori itself is not affected.

**Permissions:** `identity` for the official Shikimori OAuth window; `storage` for tokens, settings and cache; `declarativeNetRequestWithHostAccess` to set the User-Agent header Shikimori's API requires, which Chrome does not allow a normal fetch to change; `contextMenus` for a single search item; host access to `shikimori.one` and `shikimori.io`, where the API lives, and to `www.google-analytics.com` for the anonymous statistics.

Contact: **support@chakalabs.com**. The current version of this policy is published at <https://shikifav.chakalabs.com/>, the address the Chrome Web Store listing points at.
