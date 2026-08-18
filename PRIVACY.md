# Политика конфиденциальности ShikiFAV

Дата последнего изменения: 2026-08-17

ShikiFAV — расширение для Chrome, которое даёт работать со списками аниме, манги и ранобэ на [Shikimori](https://shikimori.io) без открытия сайта.

## Коротко

**У расширения нет своего сервера и нет рекламы.** Списки, оценки и прогресс остаются на Shikimori, а токены доступа, профиль и настройки лежат в хранилище вашего браузера.

Совсем без данных о вас расширение при этом не обходится, и это не скрывается: оно хранит токены доступа и профиль Shikimori (ник, идентификатор, адрес аватара), читает выделенный вами текст — только когда вы сами выбрали пункт контекстного меню, — и отправляет обезличенные события об использовании функций, пока включена анонимная статистика. Пока вы вошли и включён счётчик новых серий, расширение вдобавок само, без открытого окна, раз в полчаса спрашивает у Shikimori, не вышли ли новые серии у тайтлов из ваших списков. Что именно, куда и на какой срок — в разделах ниже.

Про **анонимную статистику использования** отдельно: расширение сообщает, какими функциями пользуются, чтобы понимать, что развивать. В ней нет ни вашего аккаунта, ни названий тайтлов, ни текстов поисковых запросов — полный список ниже, в разделе «Анонимная статистика». Она **включена по умолчанию и выключается одним переключателем** в «Настройки → Аккаунт и данные → Анонимная статистика».

## Что хранится в браузере

В `chrome.storage.local` — до тех пор, пока вы не выйдете или не удалите расширение:

- **токены доступа Shikimori** (access и refresh), полученные при входе через официальную авторизацию сайта;
- **профиль** — ник, идентификатор и адрес аватара, как их вернул Shikimori;
- **настройки** — тема, домен API, язык названий, стартовая вкладка и фильтры по умолчанию;
- **случайный идентификатор установки** — только пока включена анонимная статистика (см. её раздел ниже);
- **снимок вышедших серий** — для каждого онгоинга из ваших списков идентификатор тайтла и число вышедших серий на момент последней проверки. По нему расширение отличает новую серию от уже виденной; названий тайтлов в снимке нет;
- **строки счётчика на иконке** — те же тайтлы с вашим прогрессом (идентификатор записи в списке, сколько серий вышло и сколько отмечено), чтобы число на иконке восстанавливалось после перезапуска браузера без запроса к сети.

Последние два появляются только у вошедшего пользователя и только при включённом счётчике новых серий, и стираются они вместе: при выходе из аккаунта, по кнопке «Очистить кэш» в настройках, в тот момент, когда вы выключаете «Счётчик на иконке» в «Настройки → Поведение → Новые серии», и при удалении расширения.

В `chrome.storage.session` — стирается при закрытии браузера (всё это нужно, чтобы popup открывался мгновенно):

- последний поисковый запрос вместе с его результатами;
- последняя просмотренная страница «Моих списков» — строки вашего списка с их статусами, оценками и прогрессом;
- последний загруженный календарь онгоингов — тоже строки вашего списка, с названиями и прогрессом по сериям;
- последняя открытая вкладка popup;
- разовые передачи между окнами расширения — «открой поиск с этим запросом» и «открой настройки на этом разделе»; каждая стирается сразу после того, как её прочитали;
- адреса, на которые ведёт клик по уведомлению о новой серии, — по одной записи на сообщение, лежащее сейчас в системном центре: адрес страницы тайтла, как его вернул Shikimori. Записи подрезаются при каждой новой: то, чего в центре уведомлений больше нет, из хранилища выбрасывается. Целиком они стираются при выходе из аккаунта, при выключении счётчика новых серий и по кнопке «Очистить кэш».

## Куда уходят запросы

Только на `shikimori.one` и `shikimori.io`: поиск, чтение ваших списков и связанных тайтлов, изменение статусов, оценок и прогресса. Запросы подписываются вашим токеном; куки сайта при этом намеренно не отправляются.

**Часть этих запросов расширение делает само, без открытого окна.** Пока вы вошли и включён счётчик новых серий («Настройки → Поведение → Новые серии»), раз в 30 минут в фоне запрашивается список онгоингов из ваших списков — чтобы узнать, не вышла ли новая серия. Это единственная фоновая активность расширения: другого повода выйти в сеть без вашего действия у него нет. Если вы не вошли или выключили счётчик, фоновых запросов не делается вовсе — ни одного.

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

## Уведомления о новых сериях

Когда фоновая проверка видит, что у тайтла из ваших списков вышла новая серия, расширение может показать системное уведомление.

- **Что в нём.** Название тайтла — в том виде, который выбран настройкой «Названия» (русское или ромадзи), — и номер вышедшей серии: «Вышла 5 серия» или «Вышли серии 5–6». Больше ничего: ни ника, ни оценок, ни ссылок.
- **Куда оно попадает.** Название и номер серии показывает операционная система, то есть они выходят за пределы окна браузера — в системный центр уведомлений. Там они живут по правилам ОС, а не расширения: сколько хранится история уведомлений и кто видит её на этом компьютере, решает система.
- **Разрешение необязательное.** «Показывать уведомления» не запрашивается при установке. Его просит кнопка «Разрешить уведомления» в «Настройки → Поведение → Новые серии» — только по вашему клику; отозвать его можно там же, где Chrome показывает разрешения расширения, на `chrome://extensions`. Без него работает всё, кроме самих уведомлений.
- **Выключаются отдельно от счётчика.** У уведомлений свой переключатель, независимый от счётчика на иконке. У выключенных уведомлений расширение даже не проверяет, выдано ли разрешение, — оно вообще не обращается к этой части Chrome.
- **Кнопок в уведомлении нет, а клик уводит на сайт.** Отметить серию прямо из уведомления нельзя: клик закрывает его и открывает новую вкладку со страницей этого тайтла на Shikimori — дальше это обычный визит на сайт, со всем, что при этом делает браузер сам (в том числе с куками сайта, которых запросы самого расширения не несут). Адрес расширение не собирает: он приходит в ответе API вместе с названием, и перед открытием вкладки расширение сверяет его с двумя известными доменами Shikimori — на чужой адрес такой клик не уведёт. Если адреса нет (ответ его не принёс, либо он уже стёрт вместе с хранилищем сессии — например, после перезапуска браузера), клик просто закрывает уведомление.
- **Больше трёх сообщений за одну проверку не показывается.** Если серии вышли сразу у нескольких тайтлов, уведомления придут по первым трём, а про остальные скажет число на иконке — их названия в системный центр не уходят вовсе. Сводного уведомления «ещё у N тайтлов» нет.
- **Статистики они не порождают.** Ни фоновая проверка, ни показ уведомления не отправляют ни одного события в анонимную статистику — список событий из раздела выше от этой функции не изменился.

## Выделенный текст

Пункт контекстного меню «Найти … на Shikimori» берёт выделенный вами текст и подставляет его в поиск расширения. Это происходит **только** когда вы сами выбрали пункт меню. Текст уходит поисковым запросом к Shikimori и вместе с результатами сохраняется в хранилище сессии браузера до его закрытия — стереть раньше можно кнопкой «Очистить кэш» в настройках. Никуда, кроме Shikimori, он не отправляется.

## Ссылки на пожертвования

Раздел «Поддержать» в настройках содержит только внешние ссылки. Расширение не принимает платежи, не запрашивает платёжные данные и не передаёт площадкам ничего о вас — переход по ссылке ничем не отличается от обычного открытия сайта.

## Как удалить данные

- **«Выйти»** в шапке — стирает токены и профиль, а вместе с ними снимок вышедших серий и строки счётчика; число на иконке гаснет, а фоновая проверка перестаёт обращаться к Shikimori — у вышедшего из аккаунта она не делает ни одного запроса. Свои уведомления о новых сериях расширение при этом убирает из системного центра: они несут названия тайтлов из списков того, кто вышел. Единственное исключение — профиль, где разрешение на уведомления к этому моменту отозвано: там расширение к этой части Chrome не обращается вовсе, и уже показанные сообщения закрываются вашим кликом или средствами ОС;
- **«Очистить кэш»** в настройках — стирает сохранённые результаты поиска и списков, а вместе с ними снимок вышедших серий, строки счётчика и адреса, на которые ведут клики по уже показанным уведомлениям (такой клик после этого только закроет сообщение). Сами уведомления кнопка из системного центра не убирает, и число на иконке в этот момент не перерисовывается: оно обновится при ближайшей фоновой проверке или после перезапуска браузера;
- **выключение счётчика новых серий** — останавливает фоновую проверку, гасит число на иконке и стирает и его строки, и снимок вышедших серий, а свои уведомления убирает из системного центра — с той же оговоркой про отозванное разрешение, что и при выходе;
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
| `alarms`                                  | будильник раз в 30 минут, по которому расширение проверяет, не вышли ли новые серии; другого применения нет, доступа к данным не даёт                                           |
| `notifications`                           | необязательное, запрашивается кнопкой в настройках: показать сообщение о вышедшей серии; без него работает всё, кроме уведомлений                                               |
| доступ к `shikimori.one` и `shikimori.io` | там находится API, с которым работает расширение; сайт исторически менял домены, поэтому поддерживаются оба, и вы можете переключить его в настройках                           |
| доступ к `www.google-analytics.com`       | отправка анонимной статистики; при выключенной статистике к этому адресу не уходит ни одного запроса                                                                            |

## Изменения политики

Если что-то из перечисленного изменится, этот документ будет обновлён вместе с версией расширения.

## Контакты

Вопросы по расширению и этой политике: **support@chakalabs.com**.

Актуальная версия этой политики опубликована по адресу <https://shikifav.chakalabs.com/> — на него же ссылается карточка расширения в Chrome Web Store.

---

# Privacy Policy (English summary)

Last updated: 2026-08-17

ShikiFAV is a Chrome extension for managing your [Shikimori](https://shikimori.io) anime, manga and light-novel lists without opening the site.

**There is no server behind the extension and no ads.** Your lists, scores and progress stay on Shikimori; access tokens, your profile and your settings stay in your browser's storage.

It does handle data about you, and this is not hidden: it stores your Shikimori access tokens and profile (nickname, id, avatar URL), it reads the text you selected — only when you pick the context-menu item yourself — and it sends anonymous usage events while the statistics below are on. While you are signed in and the new-episode counter is on, it also asks Shikimori every 30 minutes, on its own and with no window open, whether new episodes of the titles in your lists have aired. What exactly, where to and for how long is in the sections that follow.

**Anonymous usage statistics.** The extension reports which features are used — which tab it opened on, that a search happened and over which catalogue, that a title was added, with what type (anime/manga) and status, which control was used to edit an entry, whether an episode was marked with the «+1» button or typed in, that an entry was removed, that the calendar or the context-menu item was used, that the related-titles screen was opened and from which type of title (anime/manga, never its name, id or number of links), which setting was changed (with the chosen value only for the theme and the API domain; toggling the statistics itself is never reported), and the kind (no network, no access, rate limit, server error) and HTTP status of a failed request — plus the extension version and a random per-install identifier. **Never sent:** search queries, title names or ids, your scores as numbers, your nickname, id or avatar, tokens, list contents, selected text. The recipient is Google (Google Analytics 4). It is **on by default and switched off** in Settings → «Аккаунт и данные» → «Анонимная статистика»; switching it off stops every request and deletes the random identifier.

**Stored in your browser.** `chrome.storage.local` keeps your Shikimori access and refresh tokens, the profile Shikimori returns (nickname, id, avatar URL), your settings, the random per-install identifier — only while the statistics are on — and two records of the new-episode watch: the **aired-episode snapshot** (for every ongoing title in your lists, its id and the number of episodes aired as of the last check — that is how the extension tells a new episode from one it has already seen; no titles are stored) and the **badge rows** (the same titles with your progress — the id of the list entry, how many episodes aired and how many you marked — so the number on the icon can be restored after a browser restart without a network request). The last two exist only while you are signed in and the counter is on, and they are erased together: when you log out, when you press «Очистить кэш» in the settings, the moment you switch the counter off in Settings → «Поведение» → «Новые серии», and when the extension is uninstalled. `chrome.storage.session`, cleared when the browser closes, keeps — so that the popup opens instantly — the last search query with its results, the last viewed page of «Мои списки» and the last loaded ongoings calendar (both are rows of your own list, with their statuses, scores and progress), the last opened popup tab, the one-shot handovers between the extension's windows («open search with this query», «open settings on this section»), each deleted as soon as it is read, and one entry per new-episode notification currently in the system tray: the address of that title's page as Shikimori returned it, so a click knows where to go. Those entries are pruned against the tray on every write and dropped entirely on logout, when the counter is switched off and by «Очистить кэш».

**Network requests go to `shikimori.one` and `shikimori.io`** — searching, reading your lists and a title's related entries, and updating statuses, scores and progress. Requests carry your token; site cookies are deliberately not sent. While you are signed in and the new-episode counter is on, the extension makes some of these requests **by itself, with no window open**: once every 30 minutes it asks for the list of ongoing titles in your lists to see whether a new episode has aired. That is the extension's only background activity — it has no other reason to go online without your action — and it makes no background request at all if you are signed out or have switched the counter off. Posters and avatars are loaded by the browser directly from Shikimori. The only other host is `www.google-analytics.com`, and only while the statistics above are on; those requests never carry your token.

**Episode notifications.** When the background check sees a new episode of a title in your lists, the extension can show a system notification.
It carries the title's name — in the form chosen by the «Названия» setting (Russian or romaji) — and the episode number («Вышла 5 серия» or «Вышли серии 5–6»), and nothing else.
That name and number are displayed by your **operating system**: they leave the browser window and land in the OS notification centre, where they are kept under the rules of the OS and not of the extension — how long the notification history lives, and who sees it on that computer, is the system's decision.
The «Display notifications» permission is **optional** and is never requested at install time: it is asked for by the «Разрешить уведомления» button in Settings → «Поведение» → «Новые серии», only on your click, and can be revoked where Chrome lists the extension's permissions on `chrome://extensions`. Everything except the notifications themselves works without it.
Notifications have their own switch, separate from the badge counter; while they are switched off the extension does not even check whether the permission was granted.
A notification carries no buttons and an episode cannot be marked from it: a click closes the notification and opens a new tab on that title's page on Shikimori — from there on it is an ordinary visit to the site, with everything the browser does on its own (site cookies included, which the extension's own requests never carry). The address is not built by the extension: it arrives in the API answer next to the name, and it is checked against the two known Shikimori domains before the tab is opened, so such a click cannot lead to a foreign host. With no address — the answer carried none, or it is already gone with the session storage after a browser restart — the click just dismisses the message.
At most three messages are shown per background check: if episodes aired for several titles at once, the first three get a notification and the number on the icon speaks for the rest, whose names never reach the notification centre. There is no summary «and N more titles» notification.
Neither the background check nor a shown notification sends a single analytics event: the list of events above is unchanged by this feature.

**Selected text** is passed to the extension's own search only when you choose the context-menu item. It is sent to Shikimori as a search query and cached with the results in `chrome.storage.session` until the browser closes (or until you press «Очистить кэш»); it goes nowhere else. Like any network request, the calls to Google Analytics carry your IP address: the extension neither reads nor stores it, but Google derives an approximate country and region from it, and switching the statistics off stops that too.

**The support section** contains outbound links only: no payments are processed and no payment details are requested.

**Removing data:** "Выйти" (log out) clears tokens and profile and, with them, the aired-episode snapshot and the badge rows — the number on the icon goes out and the background check stops making requests — it issues none at all while you are signed out — and the extension also takes its own new-episode notifications back out of the OS notification centre, because they carry the names of titles from the lists of whoever just left; the one exception is a profile where the notifications permission has been revoked by then — there the extension does not touch that part of Chrome at all, and messages already shown are left for you or the OS to dismiss; "Очистить кэш" clears the cached search and lists together with the aired-episode snapshot, the badge rows and the click addresses of the notifications still in the tray (such a click then only dismisses the message, and the messages themselves stay), while the number on the icon is not repainted right then — it catches up at the next background check or browser restart; switching the new-episode counter off stops the background check, clears the icon, deletes both the badge rows and the aired-episode snapshot, and takes our notifications out of the notification centre under the same revoked-permission caveat as the logout; switching the statistics off deletes the random identifier; and uninstalling the extension removes its storage entirely. Data held by Shikimori itself is not affected.

**Permissions:** `identity` for the official Shikimori OAuth window; `storage` for tokens, settings and cache; `declarativeNetRequestWithHostAccess` to set the User-Agent header Shikimori's API requires, which Chrome does not allow a normal fetch to change; `contextMenus` for a single search item; `alarms` for the 30-minute timer that drives the new-episode check and nothing else (it grants no access to data); the optional `notifications`, requested by a button in the settings, to show a message about an aired episode — everything but the notifications works without it; host access to `shikimori.one` and `shikimori.io`, where the API lives, and to `www.google-analytics.com` for the anonymous statistics.

Contact: **support@chakalabs.com**. The current version of this policy is published at <https://shikifav.chakalabs.com/>, the address the Chrome Web Store listing points at.
