<template>
    <div class="options">
        <!-- Full-width bar, content aligned to the same column as the grid
             below it. -->
        <div class="options__bar">
            <div class="options__bar-inner">
                <img
                    class="options__logo"
                    :src="iconUrl"
                    alt=""
                    width="26"
                    height="26"
                />
                <h1 class="options__heading">{{ i18n.options.title }}</h1>
                <div class="options__app">{{ i18n.app.name }}</div>
            </div>
        </div>

        <div class="options__wrap">
            <nav class="options__side">
                <div
                    class="options__tabs"
                    role="tablist"
                    aria-orientation="vertical"
                    :aria-label="i18n.options.sectionsLabel"
                >
                    <!-- Only the active panel is in the DOM, so aria-controls
                         belongs to the selected tab alone. -->
                    <button
                        v-for="(section, index) in SECTIONS"
                        :id="tabId(section.id)"
                        :key="section.id"
                        :ref="(el) => setTabEl(el, index)"
                        class="options__tab"
                        :class="{ 'options__tab--active': section.id === activeId }"
                        type="button"
                        role="tab"
                        :aria-selected="section.id === activeId"
                        :aria-controls="section.id === activeId ? PANEL_ID : undefined"
                        :tabindex="section.id === activeId ? 0 : -1"
                        @click="activate(index)"
                        @keydown="onTabKeydown"
                    >
                        <!-- Always in the layout, transparent when idle: an
                             active tab must not shift its own label. -->
                        <span
                            class="options__tab-bar"
                            aria-hidden="true"
                        ></span>
                        <span
                            class="options__tab-label"
                            :class="{ 'options__tab-label--wide': section.shortLabel }"
                            >{{ section.label }}</span
                        >
                        <span
                            v-if="section.shortLabel"
                            class="options__tab-label options__tab-label--narrow"
                            >{{ section.shortLabel }}</span
                        >
                    </button>
                </div>
            </nav>

            <div
                :id="PANEL_ID"
                class="options__panel"
                role="tabpanel"
                :aria-labelledby="tabId(activeId)"
            >
                <!-- --- «Вид» --- -->
                <template v-if="activeId === 'view'">
                    <section class="opt">
                        <div class="opt__label">{{ i18n.options.themeLabel }}</div>
                        <p class="opt__hint">{{ i18n.options.themeHint }}</p>
                        <div class="opt__chips">
                            <ChipGroup
                                :options="THEME_OPTIONS"
                                :model-value="settings.theme"
                                :aria-label="i18n.options.themeLabel"
                                @update:model-value="write({ theme: $event })"
                            />
                        </div>
                    </section>

                    <section class="opt">
                        <div class="opt__label">{{ i18n.options.titleLangLabel }}</div>
                        <p class="opt__hint">{{ i18n.options.titleLangHint }}</p>
                        <div class="opt__chips">
                            <ChipGroup
                                :options="TITLE_LANG_OPTIONS"
                                :model-value="settings.titleLang"
                                :aria-label="i18n.options.titleLangLabel"
                                @update:model-value="write({ titleLang: $event })"
                            />
                        </div>
                    </section>
                </template>

                <!-- --- «Поведение» --- -->
                <template v-else-if="activeId === 'behavior'">
                    <section class="opt">
                        <div class="opt__label">{{ i18n.options.startTabLabel }}</div>
                        <p class="opt__hint">{{ i18n.options.startTabHint }}</p>
                        <div class="opt__chips">
                            <ChipGroup
                                :options="START_TAB_OPTIONS"
                                :model-value="settings.startTab"
                                :aria-label="i18n.options.startTabLabel"
                                @update:model-value="write({ startTab: $event })"
                            />
                        </div>
                    </section>

                    <section class="opt">
                        <div class="opt__label">{{ i18n.options.quickStatusLabel }}</div>
                        <p class="opt__hint">{{ i18n.options.quickStatusHint }}</p>
                        <div class="opt__chips">
                            <ChipGroup
                                :options="STATUS_OPTIONS"
                                :model-value="settings.quickStatus"
                                status-dots
                                :aria-label="i18n.options.quickStatusLabel"
                                @update:model-value="write({ quickStatus: $event })"
                            />
                        </div>
                    </section>

                    <section class="opt">
                        <div class="opt__label">{{ i18n.options.defaultsLabel }}</div>
                        <p class="opt__hint">{{ i18n.options.defaultsHint }}</p>

                        <div class="opt__sub">
                            <div class="opt__sub-label">{{ i18n.options.defaultTypeLabel }}</div>
                            <div class="opt__chips">
                                <ChipGroup
                                    :options="TYPE_OPTIONS"
                                    :model-value="settings.defaultSearchType"
                                    :aria-label="i18n.options.defaultTypeLabel"
                                    @update:model-value="write({ defaultSearchType: $event })"
                                />
                            </div>
                        </div>

                        <div class="opt__sub">
                            <div class="opt__sub-label">
                                {{ i18n.options.defaultListStatusLabel }}
                            </div>
                            <div class="opt__chips">
                                <ChipGroup
                                    :options="STATUS_OPTIONS"
                                    :model-value="settings.defaultListStatus"
                                    status-dots
                                    :aria-label="i18n.options.defaultListStatusLabel"
                                    @update:model-value="write({ defaultListStatus: $event })"
                                />
                            </div>
                        </div>
                    </section>

                    <!-- «Новые серии» (Ф11-11, US-12). Last block of the
                         section: it is about what the extension does while
                         nobody is looking, which is what «Поведение» is for.
                         Two labelled chip rows in one block is the anatomy of
                         «Фильтры по умолчанию» right above it — the rows are
                         NOT equals though: without the poll there are no
                         notifications, so the second row goes disabled while
                         the first is off and keeps showing the value it will
                         return to. -->
                    <section class="opt">
                        <div class="opt__label">{{ i18n.options.episodesLabel }}</div>
                        <p class="opt__hint">{{ i18n.options.episodesHint }}</p>

                        <div class="opt__sub">
                            <div class="opt__sub-label">{{ i18n.options.badgeRowLabel }}</div>
                            <div class="opt__chips">
                                <ChipGroup
                                    :options="BADGE_OPTIONS"
                                    :model-value="settings.episodeWatch ? EPISODES_ON : 'off'"
                                    :disabled="episodesLocked"
                                    :aria-label="i18n.options.badgeRowLabel"
                                    :aria-describedby="
                                        episodesState === 'noAuth' ? EPISODES_STATUS_ID : undefined
                                    "
                                    @update:model-value="setEpisodeWatch"
                                />
                            </div>
                        </div>

                        <!-- Both reasons for a dimmed row are said out loud and
                             both reach the a11y tree through aria-describedby:
                             greyed chips with no stated reason are a dead
                             control to a screen reader. -->
                        <div class="opt__sub">
                            <div class="opt__sub-label">{{ i18n.options.notifyRowLabel }}</div>
                            <div class="opt__chips">
                                <ChipGroup
                                    :options="NOTIFY_OPTIONS"
                                    :model-value="
                                        settings.episodeNotifications ? EPISODES_ON : 'off'
                                    "
                                    :disabled="notifyLocked"
                                    :aria-label="i18n.options.notifyRowLabel"
                                    :aria-describedby="
                                        notifyLocked ? EPISODES_STATUS_ID : undefined
                                    "
                                    @update:model-value="setEpisodeNotifications"
                                />
                            </div>
                        </div>

                        <!-- The trailing line exists only where something
                             depends on it: with notifications off the row has
                             already said everything, and «разрешение выдано»
                             under a switched-off row would report a permission
                             nothing uses. -->
                        <div
                            v-if="episodesStatus"
                            class="opt__sub"
                        >
                            <p
                                :id="EPISODES_STATUS_ID"
                                class="opt__hint"
                            >
                                {{ episodesStatus }}
                            </p>
                            <!-- The only place the permission is asked for, and
                                 a ghost button like «Очистить кэш»: nothing is
                                 saved on this page, so a filled one would
                                 shout. -->
                            <div
                                v-if="episodesState === 'missing'"
                                class="opt__buttons"
                            >
                                <button
                                    class="opt__btn"
                                    type="button"
                                    @click="allowNotifications"
                                >
                                    {{ i18n.options.notifyAllow }}
                                </button>
                            </div>
                        </div>
                    </section>
                </template>

                <!-- --- «Аккаунт и данные» --- -->
                <template v-else-if="activeId === 'account'">
                    <section class="opt">
                        <div class="opt__label">{{ i18n.options.originLabel }}</div>
                        <p class="opt__hint">
                            {{ i18n.options.originHint }}
                            <!-- The consequence of the switch must read, not be
                                 muted: the warning stands here, before the
                                 click, instead of a confirmation dialog. -->
                            <b>{{ i18n.options.originHintSession }}</b>
                        </p>
                        <div class="opt__select">
                            <XSelect
                                :options="ORIGIN_OPTIONS"
                                :model-value="settings.origin"
                                :aria-label="i18n.options.originLabel"
                                @update:model-value="changeOrigin"
                            />
                        </div>
                    </section>

                    <section class="opt">
                        <div class="opt__label">{{ i18n.options.dataLabel }}</div>
                        <p class="opt__hint">{{ i18n.options.dataHint }}</p>
                        <div class="opt__buttons">
                            <button
                                class="opt__btn"
                                type="button"
                                @click="clearCache"
                            >
                                {{ i18n.options.clearCache }}
                            </button>
                            <!-- Anonymous (including right after a domain
                                 switch): there is no session to end. -->
                            <button
                                v-if="status === 'authorized'"
                                class="opt__btn opt__btn--danger"
                                type="button"
                                :disabled="pending"
                                @click="logout"
                            >
                                {{ i18n.options.logout }}
                            </button>
                        </div>
                    </section>

                    <!-- Статистика стоит здесь, а не в «Поведении»: это про
                         данные, а не про то, как расширение себя ведёт.
                         Переключатель — тот же ChipGroup, что и у остальных
                         настроек: отдельный чекбокс стоил бы новых стилей, а
                         запас бюджета options CSS — 0,3 КБ (docs/05). -->
                    <section class="opt">
                        <div class="opt__label">{{ i18n.options.analyticsLabel }}</div>
                        <p class="opt__hint">{{ i18n.options.analyticsHint }}</p>
                        <div class="opt__chips">
                            <ChipGroup
                                :options="ANALYTICS_OPTIONS"
                                :model-value="settings.analytics ? ANALYTICS_ON : 'off'"
                                :aria-label="i18n.options.analyticsLabel"
                                @update:model-value="setAnalytics"
                            />
                        </div>
                    </section>
                </template>

                <!-- --- «Поддержать» --- -->
                <template v-else>
                    <!-- Both blocks are a heading over a list of links, so they
                         share one template; which of them exist, and under what
                         heading, is decided in the script from the data. -->
                    <section
                        v-for="block in SUPPORT_BLOCKS"
                        :key="block.id"
                        class="opt"
                    >
                        <div class="opt__label">{{ block.label }}</div>
                        <p
                            v-if="block.hint"
                            class="opt__hint"
                        >
                            {{ block.hint }}
                        </p>
                        <ul class="sup">
                            <li
                                v-for="item in block.items"
                                :key="item.id"
                                class="sup__item"
                            >
                                <!-- One rule for every line of the section, mail
                                     included: a new tab, and this page stays
                                     where it is. The mail line used to be the
                                     exception, until the smoke of 2026-08-10
                                     showed what that costs — with a web handler
                                     registered for mailto: (Gmail), a link
                                     without target navigates the settings tab
                                     itself onto a compose form, and the settings
                                     are simply gone. The price of the rule is an
                                     empty tab for whoever has no handler at all;
                                     that is the smaller loss. -->
                                <a
                                    v-if="item.href"
                                    class="sup__name"
                                    :href="item.href"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <!-- The underline lives on the text, not on
                                         the link: on the link it would run
                                         under the icon too. -->
                                    <span class="sup__text">{{ item.label }}</span>
                                    <!-- The glyph promises «opens separately,
                                         this page stays» — which is now true of
                                         mail too. aria-hidden: «opens in a new
                                         tab» said five times in a row is noise,
                                         the glyph and the convention are
                                         enough. -->
                                    <svg
                                        class="sup__ext"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2"
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        aria-hidden="true"
                                    >
                                        <path
                                            d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
                                        />
                                        <polyline points="15 3 21 3 21 9" />
                                        <line
                                            x1="10"
                                            y1="14"
                                            x2="21"
                                            y2="3"
                                        />
                                    </svg>
                                </a>
                                <!-- No address — plain text, not a dead link. -->
                                <span
                                    v-else
                                    class="sup__name"
                                    >{{ item.label }}</span
                                >
                                <span class="sup__note"> — {{ item.note }}</span>
                            </li>
                        </ul>
                    </section>
                </template>
            </div>

            <!-- A caption, not a section of its own: visible from any section,
                 and the grid moves it under the panel in a narrow window. -->
            <div class="options__version">{{ i18n.options.version }} {{ version }}</div>
        </div>

        <!-- :key re-mounts the toast, restarting its auto-close timer even when
             the same text is shown twice in a row. -->
        <Toast
            v-if="toast"
            :key="toast.nonce"
            :text="toast.text"
            @closed="toast = null"
        />
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { browser } from 'wxt/browser';
import ChipGroup from '@/src/components/ChipGroup.vue';
import type { ChipOption } from '@/src/components/ChipGroup.vue';
import Toast from '@/src/components/Toast.vue';
import XSelect from '@/src/components/XSelect.vue';
import type { XSelectOption } from '@/src/components/XSelect.vue';
import { reportEvent } from '@/src/lib/analytics-report';
import { useAuth } from '@/src/composables/use-auth';
import { useSettings } from '@/src/composables/use-settings';
import type { SearchType, UserRateStatus } from '@/src/lib/api/types';
import { DEFAULT_ORIGIN, ORIGINS } from '@/src/lib/config';
import type { Origin } from '@/src/lib/config';
import { DONATION_METHODS, payHref, SUPPORT_ACTIONS, supportHref } from '@/src/lib/donations';
import type { SupportActionId } from '@/src/lib/donations';
import { apiErrorMessage, i18n, statusLabel } from '@/src/lib/i18n';
import { sendMessage } from '@/src/lib/messaging';
import {
    hasNotificationsPermission,
    onNotificationsPermissionChanged,
    requestNotificationsPermission,
} from '@/src/lib/notifications-permission';
import {
    clearAiredSnapshot,
    clearBadgeBacklog,
    clearSession,
    FALLBACK_OPTIONS_SECTION,
    forgetAnalyticsClientId,
    getSession,
    isOptionsSection,
    removeSession,
    setSettings,
} from '@/src/lib/storage';
import type { LocalState, OptionsSection, StartTab, Theme } from '@/src/lib/storage';

// Options page (design card screens/options): seven settings behind three
// vertical tabs, plus «Поддержать» as a fourth (Ф8). Opened in its own tab, so
// the page owns no shell — the header is a full-width bar and everything lines
// up in one 1400px column.
//
// The version comes from the entrypoint as a prop: the component never touches
// the extension runtime, which keeps it mountable in tests.
// iconUrl arrives as a prop for the same reason as version: the page stays
// mountable without the extension runtime (component tests).
defineProps<{ version: string; iconUrl: string }>();

// Every control writes storage directly (CLAUDE.md rule 1 restricts network,
// not storage) — except the API domain, which has to end the session first and
// therefore goes through background. There is no «Сохранить» button.
const { settings } = useSettings();
const { status, pending, logout, refreshState } = useAuth();

// --- sections ---------------------------------------------------------------

// The ids live in storage.ts, next to the session key that hands a section over
// from the popup header (Ф8-3).
interface Section {
    id: OptionsSection;
    label: string;
    // Narrow window: the tabs become a horizontal row, where the full label of
    // «Аккаунт и данные» no longer fits. CSS swaps the two spans — a resize
    // listener would buy nothing here.
    shortLabel?: string;
}

// Order is deliberate: what is changed once and seen immediately, then what
// changes the habit of opening the popup, then what costs something (the domain
// ends the session, «Выйти» ends it too), and last the one section that is not
// a setting at all.
const SECTIONS: readonly Section[] = [
    { id: 'view', label: i18n.options.sectionView },
    { id: 'behavior', label: i18n.options.sectionBehavior },
    {
        id: 'account',
        label: i18n.options.sectionAccount,
        shortLabel: i18n.options.sectionAccountShort,
    },
    { id: 'support', label: i18n.options.sectionSupport },
];

const PANEL_ID = 'options-panel';

function tabId(id: OptionsSection): string {
    return `options-tab-${id}`;
}

// Never -1: the two lists of sections (OPTIONS_SECTIONS in storage.ts and the
// labelled SECTIONS above) are kept in sync by hand — a test pins that — but a
// miss must not reach activeId, where SECTIONS[-1].id would throw and leave the
// settings page blank. A page that cannot draw is also the page a broken
// profile would have to be fixed from (Ф6-23).
function indexOfSection(id: OptionsSection): number {
    const index = SECTIONS.findIndex((section) => section.id === id);
    if (index >= 0) {
        return index;
    }
    const fallback = SECTIONS.findIndex((section) => section.id === FALLBACK_OPTIONS_SECTION);
    // Both missing at once means SECTIONS itself is broken; the first tab is
    // still a page, and a blank one is not.
    return fallback >= 0 ? fallback : 0;
}

// The page always opens on «Вид»; the last opened section is not remembered —
// no storage key is added for it. The only thing that can move it is a one-shot
// handover from the popup header (see below).
const activeIndex = ref(indexOfSection(FALLBACK_OPTIONS_SECTION));
const activeId = computed<OptionsSection>(() => SECTIONS[activeIndex.value].id);

// Roving tabindex: only the selected tab is tabbable, the arrows move both the
// selection and the focus, so the tab list is one Tab stop.
const tabEls: Array<{ focus(): void } | null> = [];

function setTabEl(el: unknown, index: number): void {
    tabEls[index] = el as { focus(): void } | null;
}

function activate(index: number): void {
    activeIndex.value = index;
}

function onTabKeydown(event: KeyboardEvent): void {
    const last = SECTIONS.length - 1;
    let next: number;
    switch (event.key) {
        // Wrapping matches the APG tabs pattern: the list is short and cycling
        // is cheaper than a dead end.
        case 'ArrowDown':
            next = activeIndex.value === last ? 0 : activeIndex.value + 1;
            break;
        case 'ArrowUp':
            next = activeIndex.value === 0 ? last : activeIndex.value - 1;
            break;
        case 'Home':
            next = 0;
            break;
        case 'End':
            next = last;
            break;
        default:
            return;
    }
    event.preventDefault();
    activate(next);
    tabEls[next]?.focus();
}

// --- section handed over by the popup header (Ф8-3) -------------------------

const PENDING_SECTION_KEY = 'pendingOptionsSection';

// One-shot handover, the pendingSearch pattern of ф.5: the heart button writes
// the key and calls openOptionsPage(), which opens this page — or merely
// focuses it, if the tab is already there. Hence both halves below: the key is
// read at mount AND followed through storage.onChanged, so an open tab switches
// the section on the fly instead of showing whatever it was left on.
//
// Never rejects: a failed read costs the jump, not the page.
async function consumePendingSection(): Promise<void> {
    const pending = await getSession(PENDING_SECTION_KEY).catch(() => undefined);
    if (pending === undefined) {
        return;
    }
    // Dropped before the switch, and regardless of what it holds: a key left
    // behind would jump the section again on the next visit.
    await removeSession(PENDING_SECTION_KEY).catch(() => {});
    // A value from another build names a section this one does not have; the
    // page then stays where it is («Вид» at open) instead of rendering a panel
    // with no tab selected — the same rule as the popup tabs (Ф7-9).
    if (isOptionsSection(pending)) {
        activeIndex.value = indexOfSection(pending);
    }
}

// Re-read instead of parsing change.newValue (same convention as
// use-settings.ts). The removal above fires this listener too: the re-read then
// finds nothing and returns, so there is no loop.
function onSessionChanged(changes: Record<string, unknown>): void {
    if (PENDING_SECTION_KEY in changes) {
        void consumePendingSection();
    }
}

onMounted(() => {
    void consumePendingSection();
    browser.storage.session.onChanged.addListener(onSessionChanged);
});

onUnmounted(() => {
    browser.storage.session.onChanged.removeListener(onSessionChanged);
});

// --- control options --------------------------------------------------------

const THEME_OPTIONS: readonly ChipOption<Theme>[] = [
    { value: 'system', label: i18n.options.themeSystem },
    { value: 'light', label: i18n.options.themeLight },
    { value: 'dark', label: i18n.options.themeDark },
];

const TITLE_LANG_OPTIONS: readonly ChipOption<LocalState['settings']['titleLang']>[] = [
    { value: 'ru', label: i18n.options.titleLangRu },
    { value: 'romaji', label: i18n.options.titleLangRomaji },
];

// Tab chips in the order of the TabBar itself, «Последняя открытая» last.
const START_TAB_OPTIONS: readonly ChipOption<StartTab>[] = [
    { value: 'search', label: i18n.tabs.search },
    { value: 'lists', label: i18n.tabs.myLists },
    { value: 'calendar', label: i18n.tabs.calendar },
    { value: 'last', label: i18n.options.startTabLast },
];

const TYPE_OPTIONS: readonly ChipOption<SearchType>[] = [
    { value: 'anime', label: i18n.lists.types.anime },
    { value: 'manga', label: i18n.lists.types.manga },
    { value: 'ranobe', label: i18n.lists.types.ranobe },
];

// US-3 status order, the same six chips as the status filter in «Мои списки».
// Anime wording: the setting is one value for all three types, and the hint
// spells out how manga/ranobe read it.
const STATUSES: readonly UserRateStatus[] = [
    'planned',
    'watching',
    'rewatching',
    'completed',
    'on_hold',
    'dropped',
];

const STATUS_OPTIONS: readonly ChipOption<UserRateStatus>[] = STATUSES.map((value) => ({
    value,
    label: statusLabel(value),
}));

// Domains come from config (CLAUDE.md rule 4), the working one first.
// Boolean over two chips instead of a checkbox — see the comment in the
// template. «Включена» first: it is the default, and the row reads as the
// current state rather than as an offer. ChipGroup is keyed by strings, so the
// setting is mapped on the edge rather than the component being widened for
// one caller.
const ANALYTICS_ON = 'on';
type AnalyticsChoice = typeof ANALYTICS_ON | 'off';

const ANALYTICS_OPTIONS: readonly ChipOption<AnalyticsChoice>[] = [
    { value: ANALYTICS_ON, label: i18n.options.analyticsOn },
    { value: 'off', label: i18n.options.analyticsOff },
];

// «Новые серии» (Ф11-11): two booleans on two chip rows, mapped on the edge the
// same way ANALYTICS_ON is — ChipGroup stays keyed by strings. Each row is
// worded for itself («счётчик включён», «уведомления включены»), so the two
// share the value vocabulary and nothing else.
const EPISODES_ON = 'on';
type EpisodesChoice = typeof EPISODES_ON | 'off';

const BADGE_OPTIONS: readonly ChipOption<EpisodesChoice>[] = [
    { value: EPISODES_ON, label: i18n.options.badgeOn },
    { value: 'off', label: i18n.options.badgeOff },
];

const NOTIFY_OPTIONS: readonly ChipOption<EpisodesChoice>[] = [
    { value: EPISODES_ON, label: i18n.options.notifyOn },
    { value: 'off', label: i18n.options.notifyOff },
];

const ORIGIN_OPTIONS: readonly XSelectOption<Origin>[] = [
    DEFAULT_ORIGIN,
    ...ORIGINS.filter((origin) => origin !== DEFAULT_ORIGIN),
].map((origin) => ({ value: origin, label: new URL(origin).host }));

// --- «Поддержать» content (Ф8-2) --------------------------------------------

// One row of either list: a name that may or may not be a link, and a note
// after it. Built once at setup — both lists are static imports, nothing here
// ever changes while the page is open.
interface SupportItem {
    id: string;
    label: string;
    note: string;
    href: string | null;
}

interface SupportBlock {
    id: string;
    label: string;
    // Only the first block of the section carries the intro paragraph.
    hint?: string;
    items: readonly SupportItem[];
}

// A way to pay IS its address: a name nobody can send money through is not an
// offer, so an entry whose url does not survive payHref() (https and nothing
// else, where the free asks below get the mail-tolerant supportHref()) is left
// out entirely — a free ask («Рассказать знакомым») reads fine as plain text, a
// cash desk does not. Same shape as the ACTION_ITEMS filter below: data, not a
// v-if.
const METHOD_ITEMS: readonly SupportItem[] = DONATION_METHODS.flatMap((method) => {
    const href = payHref(method);
    return href === null
        ? []
        : [
              {
                  id: method.id,
                  label: method.label,
                  note: method.hint,
                  href,
              },
          ];
});

// The wording of a free action is keyed by its id: unlike a payment method, it
// does not change together with an address, so it stays in i18n. The Record is
// keyed by the union — a new action does not compile without its two strings.
const SUPPORT_ACTION_TEXT: Record<SupportActionId, { label: string; note: string }> = {
    review: { label: i18n.options.helpReview, note: i18n.options.helpReviewNote },
    share: { label: i18n.options.helpShare, note: i18n.options.helpShareNote },
    bug: { label: i18n.options.helpBug, note: i18n.options.helpBugNote },
    telegram: { label: i18n.options.helpTelegram, note: i18n.options.helpTelegramNote },
};

const ACTION_ITEMS: readonly SupportItem[] = SUPPORT_ACTIONS.filter(
    // Data, not a v-if by id: an ask that is nothing but a link waits for its
    // address, everything else is shown as text.
    (action) => !action.needsUrl || supportHref(action) !== null,
).map((action) => {
    const href = supportHref(action);
    return {
        id: action.id,
        ...SUPPORT_ACTION_TEXT[action.id],
        href,
    };
});

// An empty list of methods is a state of its own, not a plate saying «пусто»:
// the block is absent from the section entirely, and the free one takes over
// both the heading («Как помочь» instead of «Как ещё помочь» — «ещё» after
// nothing hangs in the air) and the intro paragraph.
const hasMethods = METHOD_ITEMS.length > 0;

const SUPPORT_BLOCKS: readonly SupportBlock[] = [
    ...(hasMethods
        ? [
              {
                  id: 'methods',
                  label: i18n.options.supportLabel,
                  hint: i18n.options.supportHint,
                  items: METHOD_ITEMS,
              },
          ]
        : []),
    {
        id: 'help',
        label: hasMethods ? i18n.options.helpLabel : i18n.options.supportEmptyLabel,
        hint: hasMethods ? undefined : i18n.options.supportEmptyHint,
        items: ACTION_ITEMS,
    },
];

// --- actions ----------------------------------------------------------------

// The nonce feeds :key so a repeated identical message still re-mounts the
// Toast and restarts its timer (a text-only watch would not fire).
const toast = ref<{ text: string; nonce: number } | null>(null);

function showToast(text: string): void {
    toast.value = { text, nonce: (toast.value?.nonce ?? 0) + 1 };
}

// A write lands back through the storage subscription of use-settings, so the
// controls have no local mirror that could drift from what is stored.
function write(patch: Partial<LocalState['settings']>): void {
    void setSettings(patch);
    reportSettingChange(patch);
}

// Ф10-14: which settings people actually touch. The name of the setting always,
// the value only where the vocabulary is fixed and says nothing about the
// person — the theme. A default status or search type would already be a hint
// about what someone reads, and `analytics` itself is left out on principle:
// the last thing an opt-out should do is report the opt-out.
function reportSettingChange(patch: Partial<LocalState['settings']>): void {
    for (const setting of Object.keys(patch)) {
        if (setting === 'analytics') {
            continue;
        }
        reportEvent({
            name: 'setting_changed',
            params: setting === 'theme' ? { setting, value: patch.theme } : { setting },
        });
    }
}

// Switching off has a second half: the stored random identifier is what makes
// past events one anonymous timeline, so it is dropped together with consent
// (src/lib/api/analytics.ts). Storage-only, no message — rule 1 restricts
// network, and waking the service worker for a local delete costs the popup
// budget for nothing.
//
// Both writes are awaited, and the order is load-bearing (Ф11 audit). The
// setting goes first because it is the gate every event reads: once it says
// "off", no event started after this point asks for an identifier at all. The
// delete goes second so that it is the LAST write of the pair — an event that
// slipped past the gate a moment before it closed cannot leave a new identifier
// behind the delete, because the client re-reads consent right before writing
// one. Fired the other way round the pair leaves the opposite window open: no
// identifier, but a stored setting still reading `true`, so the very next event
// creates one and sends.
async function writeAnalytics(analytics: boolean): Promise<void> {
    await setSettings({ analytics });
    if (!analytics) {
        await forgetAnalyticsClientId();
    }
}

// Not through write(): the sequence above has to be awaited, and the reporting
// write() does is skipped for `analytics` anyway (see reportSettingChange — the
// last thing an opt-out should do is report the opt-out).
function setAnalytics(choice: AnalyticsChoice): void {
    void writeAnalytics(choice === ANALYTICS_ON);
}

// --- «Новые серии» (Ф11-11, US-12) ------------------------------------------

// One id for one line: whichever reason is on screen, it is the one the dimmed
// rows point at with aria-describedby.
const EPISODES_STATUS_ID = 'options-episodes-status';

// null = not asked yet. The answer arrives a microtask after mount, and until it
// does the block must claim neither «разрешены» nor «разрешения нет» — either
// would be a line of text flipping in front of the reader.
const notificationsGranted = ref<boolean | null>(null);

let stopWatchingPermission: (() => void) | null = null;

onMounted(() => {
    void hasNotificationsPermission().then((granted) => {
        notificationsGranted.value = granted;
    });
    // Changed from chrome://extensions while this tab is open, either way:
    // without this the page would keep promising «Уведомления разрешены» after a
    // revoke, and would keep offering the button after a grant made elsewhere.
    stopWatchingPermission = onNotificationsPermissionChanged((granted) => {
        notificationsGranted.value = granted;
    });
});

onUnmounted(() => {
    stopWatchingPermission?.();
    stopWatchingPermission = null;
});

// The five drawings of the block (design card), in the order they shadow each
// other: sign-in first, then the badge row, then the notification row, and only
// inside a working feature does the Chrome permission matter at all.
// 'unknown' is not a sixth state — it renders exactly like 'notifyOff', with no
// status line, and exists only between mount and the two answers.
type EpisodesState = 'noAuth' | 'needsBadge' | 'notifyOff' | 'granted' | 'missing' | 'unknown';

const episodesState = computed<EpisodesState>(() => {
    if (status.value === 'anonymous') {
        return 'noAuth';
    }
    if (!settings.value.episodeWatch) {
        return 'needsBadge';
    }
    if (!settings.value.episodeNotifications) {
        return 'notifyOff';
    }
    if (status.value === 'loading' || notificationsGranted.value === null) {
        return 'unknown';
    }
    return notificationsGranted.value ? 'granted' : 'missing';
});

// A state that says nothing carries no line at all, rather than a muted line
// with nothing in it: «разрешение выдано» under a switched-off row would report
// a permission nothing uses.
const EPISODES_STATUS_TEXT: Record<EpisodesState, string | null> = {
    noAuth: i18n.options.episodesNoAuth,
    needsBadge: i18n.options.notifyNeedsBadge,
    notifyOff: null,
    granted: i18n.options.notifyGranted,
    missing: i18n.options.notifyMissing,
    unknown: null,
};

const episodesStatus = computed<string | null>(() => EPISODES_STATUS_TEXT[episodesState.value]);

// Without a session the counter has nothing to count, so both rows are dimmed —
// and they keep their stored values: the settings did not change, they just do
// not work.
const episodesLocked = computed(() => status.value === 'anonymous');

// The subordination is a rendering rule, not a stored one: episodeNotifications
// is never rewritten by switching the badge off, so it comes back as it was.
const notifyLocked = computed(() => episodesLocked.value || !settings.value.episodeWatch);

function setEpisodeWatch(choice: EpisodesChoice): void {
    write({ episodeWatch: choice === EPISODES_ON });
}

// Switching the row off does NOT revoke the Chrome permission (owner decision):
// the row is the control, and revoking would buy a second system dialog on
// every way back.
function setEpisodeNotifications(choice: EpisodesChoice): void {
    write({ episodeNotifications: choice === EPISODES_ON });
}

// Nothing is awaited before the request: Chrome only grants the ask inside a
// user gesture, and an ask made after an await is refused for a reason nobody
// can tell from «нет». A refusal changes nothing on screen — same line, same
// button — so it is what the toast is for.
async function allowNotifications(): Promise<void> {
    const granted = await requestNotificationsPermission();
    notificationsGranted.value = granted;
    if (!granted) {
        showToast(i18n.options.notifyDenied);
    }
}

async function changeOrigin(origin: Origin): Promise<void> {
    // The one setting the UI must not write itself: background ends the session
    // first and stores the origin only after that (docs/04).
    const response = await sendMessage('settings.setOrigin', { origin });
    if (!response.ok) {
        // The select has no local mirror, so it silently snaps back to the
        // stored domain: without this toast the click would look ignored.
        showToast(apiErrorMessage(response.error));
        return;
    }
    // Reported only after the switch actually happened: a failed one snaps the
    // select back, and an event for it would count a change that never was.
    // The domain is a fixed pair and belongs to the service, not to the person.
    reportEvent({
        name: 'setting_changed',
        params: { setting: 'origin', value: origin === 'https://shikimori.one' ? 'one' : 'io' },
    });
    // The session is over — re-read the auth state so the page stops
    // offering «Выйти» instead of pretending the user is still signed in.
    await refreshState();
}

async function clearCache(): Promise<void> {
    await clearSession();
    // Ф11 audit: the two local caches of the airing watch go with the session
    // one. Both describe the lists of this account — the snapshot is «тайтл →
    // сколько серий вышло», the backlog is what the number on the icon counts —
    // and a button that says «Очистить кэш» must not leave list data behind just
    // because it was written to storage.local. The counter is rebuilt by the
    // next tick; nothing here reaches browser.action, which is background-only.
    await clearAiredSnapshot();
    await clearBadgeBacklog();
    showToast(i18n.options.cacheCleared);
}
</script>

<style scoped lang="scss">
/* Design card screens/options. The page fills the tab; the header bar spans the
   full width while its content, the tab list and the panel share one 1400px
   column. The computed 880 (216 sidebar + 28 + 560 reading measure) was tried
   and rejected by the owner: on a desktop monitor it reads as a narrow strip
   stranded in a wide window. The 560px measure did not go anywhere — it lives
   on the settings blocks themselves (.opt__hint, the chip rows), so the panel
   is wider than the measure but its text never stretches. */
.options {
    /* Toast: fixed 12px off both edges reads as a full-screen band on a wide
       tab, so here it is clamped to the content column and centred with it. */
    --toast-width: min(100% - 24px, 832px);
    --toast-margin-inline: auto;

    display: flex;
    flex-direction: column;
    min-height: 100vh;
}

.options__bar {
    border-bottom: 1px solid var(--color-border);
}

.options__bar-inner {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    max-width: 1400px;
    margin: 0 auto;
    padding: 10px 24px;
}

/* The extension icon itself, not a stand-in glyph: whatever ships in the
   manifest is what the header shows. The mark is drawn on its own white sheet
   (see assets/icon/icon.svg), so no themed background is needed under it. */
.options__logo {
    flex: 0 0 auto;
    width: 26px;
    height: 26px;
    border-radius: 7px;
}

.options__heading {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: 14px;
    font-weight: 600;
}

.options__app {
    font-size: 12px;
    color: var(--color-fg-muted);
}

/* Grid, not flex, so the version line can sit last in the DOM and still land in
   the bottom-left cell — the same markup reflows in a narrow window without
   duplicating the element. */
.options__wrap {
    display: grid;
    grid-template-rows: 1fr auto;
    grid-template-columns: 216px minmax(0, 1fr);

    /* Fills the height left by the bar (.options is a 100vh flex column), so
       the divider runs the whole window and the version line sits at its
       bottom instead of floating under the tallest section. */
    flex: 1;
    min-height: 0;
    width: 100%;
    max-width: 1400px;
    margin: 0 auto;
    padding: 20px 24px 28px;
}

.options__side {
    grid-area: 1 / 1 / 2 / 2;
    padding-right: 20px;
}

.options__tabs {
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.options__tab {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    padding: 8px 12px 8px 9px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--color-fg-muted);
    font: inherit;
    font-size: 13.5px;
    font-weight: 500;
    text-align: left;

    &:hover {
        background: color-mix(in srgb, var(--color-fg) 6%, transparent);
        color: var(--color-fg);
    }

    /* Tighter than the foundation default: the tabs sit 2px apart. */
    &:focus-visible {
        outline-offset: 1px;
    }
}

.options__tab--active {
    background: var(--color-surface);
    color: var(--color-fg);
    font-weight: 600;
}

.options__tab-bar {
    flex: 0 0 auto;
    width: 3px;
    height: 16px;
    border-radius: 2px;
    /* The bar belongs to the selection, not to the cursor: transparent while
       idle, so it never shifts the label it precedes. */
    background: transparent;
}

.options__tab--active .options__tab-bar {
    background: var(--color-accent);
}

/* The narrow label is swapped in by the media query at the bottom. */
.options__tab-label--narrow {
    display: none;
}

.options__panel {
    grid-area: 1 / 2 / 3 / 3;
    /* Floor = the height of the tallest section («Поведение»), so switching
       sections moves nothing at all; shorter ones get whitespace. Since the
       wrap stretches to the window, this only bites on a window shorter than
       the tallest section.
       790, not 460, since Ф11-11: «Новые серии» took the tallest state of
       «Поведение» to 786,63 px, and the floor covers all five states of the
       block, so clicking its chips does not move the page either. The price is
       stated in docs/05 — below ≈885 px of window height every section now
       scrolls. */
    min-height: 790px;
    padding-left: 28px;
    border-left: 1px solid var(--color-border);
}

.options__version {
    grid-area: 2 / 1 / 3 / 2;
    align-self: end;
    padding: 16px 12px 0;
    font-size: 12px;
    color: var(--color-fg-muted);
}

/* --- one setting block --- */

.opt {
    padding: 16px 0;
    border-bottom: 1px solid var(--color-border);

    &:first-child {
        padding-top: 2px;
    }

    /* Last block of a section: no trailing line, there is nothing below it. */
    &:last-child {
        padding-bottom: 0;
        border-bottom: 0;
    }
}

.opt__label {
    margin-bottom: 3px;
    font-weight: 600;
}

.opt__hint {
    max-width: 560px;
    margin: 0 0 11px;
    font-size: 13px;
    color: var(--color-fg-muted);

    b {
        color: var(--color-fg);
        font-weight: 600;
    }

    /* A hint that ends its block (the status line of «Новые серии») carries no
       gap of its own — the padding of .opt already ends the block. The only new
       rule of Ф11-11; +7 B gzip, measured (2813 -> 2820 B, docs/05). */
    &:last-child {
        margin-bottom: 0;
    }
}

/* Two labelled chip rows inside one block («Фильтры по умолчанию»). */
.opt__sub + .opt__sub {
    margin-top: 12px;
}

.opt__sub-label {
    margin-bottom: 6px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--color-fg-muted);
}

/* The wrapper owns the reading measure, so ChipGroup keeps its own class names
   to itself (Ф6-6): at the full panel width the six status chips would orphan
   «Брошено», inside 560 they split 4 + 2 as in «Мои списки». */
.opt__chips {
    max-width: 560px;
}

.opt__select {
    width: 240px;
}

.opt__buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
}

/* The same ghost button as «Повторить» (ErrorState); the danger variant only
   paints its label — a filled button would shout on a page where nothing is
   destroyed. */
.opt__btn {
    padding: 8px 16px;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    background: transparent;
    color: var(--color-fg);
    font: inherit;
    font-size: 13px;
    font-weight: 600;

    &:hover:not(:disabled) {
        background: var(--color-surface);
    }
}

.opt__btn--danger {
    color: var(--color-danger);

    &:hover:not(:disabled) {
        border-color: color-mix(in srgb, var(--color-danger) 45%, transparent);
        background: color-mix(in srgb, var(--color-danger) 8%, transparent);
    }
}

/* --- «Поддержать»: a list of links, not a wall of cards ---
   Same reading measure as the settings blocks; a way to support the project is
   one line, so the list needs no boxes of its own. */

.sup {
    max-width: 560px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 13px;
}

.sup__item {
    padding: 4px 0;
    line-height: 1.5;
    /* Carries the muted colour for the note too — the name paints over it. */
    color: var(--color-fg-muted);
}

/* A name without a link («Рассказать знакомым»): text colour, not the accent —
   accent without an href reads as a broken link. */
.sup__name {
    color: var(--color-fg);
    font-weight: 500;
}

a.sup__name {
    color: var(--color-accent);
    text-decoration: none;

    /* The underline sits on the text, so the line stops before the icon. */
    .sup__text {
        text-decoration: underline;
        text-decoration-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
        text-underline-offset: 2px;
    }

    &:hover {
        color: var(--color-accent-hover);

        .sup__text {
            text-decoration-color: currentcolor;
        }
    }
}

.sup__ext {
    width: 11px;
    height: 11px;
    margin-left: 4px;
    vertical-align: -1px;
    opacity: 0.85;
}

/* --- narrow window: the sidebar moves up as a horizontal row ---
   Icons instead of labels were rejected: three Russian words fit, and the
   extension has no icon set to invent three glyphs from. */
@media (width <= 620px) {
    .options__bar-inner {
        padding: 10px 16px;
    }

    .options__wrap {
        /* The panel row takes the slack, not the tab row: with three auto rows
           the stretched wrap pushed the rule 170px below the tabs it belongs
           to. */
        grid-template-rows: auto 1fr auto;
        grid-template-columns: minmax(0, 1fr);
        padding: 14px 16px 22px;
    }

    .options__side {
        grid-area: 1 / 1 / 2 / 2;
        padding: 0 0 10px;
        border-bottom: 1px solid var(--color-border);
    }

    .options__tabs {
        flex-direction: row;
        gap: 6px;
    }

    .options__tab {
        width: auto;
        padding: 6px 10px 6px 8px;
    }

    .options__tab-label--wide {
        display: none;
    }

    .options__tab-label--narrow {
        display: inline;
    }

    /* The vertical rule is gone; the line under the tab row takes its role. */
    .options__panel {
        grid-area: 2 / 1 / 3 / 2;
        min-height: 0;
        /* 14, not 16: `.opt:first-child` adds its own 2px on top, so the first
           heading sits 16px below the rule — the gap the blocks keep between
           each other. Wide mode has the rule beside the panel, not above it,
           and needs none of this. */
        padding-top: 14px;
        padding-left: 0;
        border-left: 0;
    }

    .options__version {
        grid-area: 3 / 1 / 4 / 2;
        padding: 16px 0 0;
    }

    .opt__select {
        width: 100%;
    }
}
</style>
