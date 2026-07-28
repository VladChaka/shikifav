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
                >
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
                </template>

                <!-- --- «Аккаунт и данные» --- -->
                <template v-else>
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
import { computed, ref } from 'vue';
import ChipGroup from '@/src/components/ChipGroup.vue';
import type { ChipOption } from '@/src/components/ChipGroup.vue';
import Toast from '@/src/components/Toast.vue';
import XSelect from '@/src/components/XSelect.vue';
import type { XSelectOption } from '@/src/components/XSelect.vue';
import { useAuth } from '@/src/composables/use-auth';
import { useSettings } from '@/src/composables/use-settings';
import type { SearchType, UserRateStatus } from '@/src/lib/api/types';
import { DEFAULT_ORIGIN, ORIGINS } from '@/src/lib/config';
import type { Origin } from '@/src/lib/config';
import { apiErrorMessage, i18n, statusLabel } from '@/src/lib/i18n';
import { sendMessage } from '@/src/lib/messaging';
import { clearSession, setSettings } from '@/src/lib/storage';
import type { LocalState, StartTab, Theme } from '@/src/lib/storage';

// Options page (design card screens/options): seven settings behind three
// vertical tabs. Opened in its own tab, so the page owns no shell — the header
// is a full-width bar and everything lines up in one 880px column.
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

type SectionId = 'view' | 'behavior' | 'account';

interface Section {
    id: SectionId;
    label: string;
    // Narrow window: the tabs become a horizontal row, where the full label of
    // «Аккаунт и данные» no longer fits. CSS swaps the two spans — a resize
    // listener would buy nothing here.
    shortLabel?: string;
}

// Order is deliberate: what is changed once and seen immediately, then what
// changes the habit of opening the popup, then what costs something (the domain
// ends the session, «Выйти» ends it too).
const SECTIONS: readonly Section[] = [
    { id: 'view', label: i18n.options.sectionView },
    { id: 'behavior', label: i18n.options.sectionBehavior },
    {
        id: 'account',
        label: i18n.options.sectionAccount,
        shortLabel: i18n.options.sectionAccountShort,
    },
];

const PANEL_ID = 'options-panel';

function tabId(id: SectionId): string {
    return `options-tab-${id}`;
}

// The page always opens on «Вид»; the last opened section is not remembered —
// no storage key is added for it.
const activeIndex = ref(0);
const activeId = computed<SectionId>(() => SECTIONS[activeIndex.value].id);

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

const START_TAB_OPTIONS: readonly ChipOption<StartTab>[] = [
    { value: 'search', label: i18n.tabs.search },
    { value: 'lists', label: i18n.tabs.myLists },
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
const ORIGIN_OPTIONS: readonly XSelectOption<Origin>[] = [
    DEFAULT_ORIGIN,
    ...ORIGINS.filter((origin) => origin !== DEFAULT_ORIGIN),
].map((origin) => ({ value: origin, label: new URL(origin).host }));

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
    // The session is over — re-read the auth state so the page stops
    // offering «Выйти» instead of pretending the user is still signed in.
    await refreshState();
}

async function clearCache(): Promise<void> {
    await clearSession();
    showToast(i18n.options.cacheCleared);
}
</script>

<style scoped lang="scss">
/* Design card screens/options. The page fills the tab; the header bar spans the
   full width while its content, the tab list and the panel share one 880px
   column. 880, not the 720 of the search page: the reading measure of the panel
   must stay ~560px, and 216 (sidebar) + 28 + 560 lands exactly there. */
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
       the tallest section. */
    min-height: 460px;
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
