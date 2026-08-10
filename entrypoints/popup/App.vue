<template>
    <div class="app">
        <!-- Auth state is being read from storage: show a calm skeleton
             instead of flashing the login screen (docs/05-ui.md). -->
        <div
            v-if="status === 'loading'"
            class="app-skeleton"
            aria-hidden="true"
        >
            <div class="app-skeleton__header">
                <span class="app-skeleton__avatar"></span>
                <span class="app-skeleton__line app-skeleton__line--nickname"></span>
            </div>
            <div class="app-skeleton__body">
                <span class="app-skeleton__line"></span>
                <span class="app-skeleton__line"></span>
                <span class="app-skeleton__line app-skeleton__line--short"></span>
            </div>
        </div>

        <template v-else-if="status === 'authorized' && user">
            <UserHeader :user="user" />
            <!-- Only a failed logout can set the error while authorized. -->
            <p
                v-if="error"
                class="app__error"
                role="alert"
            >
                {{ apiErrorMessage(error) }}
            </p>

            <!-- Everything the «Связанные» overlay covers: the tab row and the
                 tab content, never the header (Ф12, design card
                 screens/related). The tabs stay mounted under it — a covered
                 tab keeps its state and its scroll position, which is what
                 makes the return one step and not a reload. -->
            <div class="app__body">
                <!-- Everything under the overlay is inert while it is open: without
                     it Tab walks straight out of the screen into the covered
                     tab, and a screen reader reads rows the user cannot see.
                     Bound to `true`/`undefined`, never to `false` — `inert` is
                     not in Vue's special-boolean list, so `:inert="false"` would
                     render inert="false" and, since presence is what counts,
                     freeze the tabs permanently. `undefined` drops the attribute
                     instead. -->
                <div
                    class="app__tabs"
                    :inert="relatedTarget ? true : undefined"
                >
                    <TabBar
                        :active="activeTab"
                        @update:active="selectTab"
                    />

                    <SearchTab
                        v-show="activeTab === 'search'"
                        :model-value="searchQuery"
                        :search-type="searchType"
                        @update:model-value="setQuery"
                        @update:search-type="setSearchType"
                    >
                        <SearchResults
                            v-model:open-menu-key="openMenuKey"
                            :items="searchItems"
                            :status="searchStatus"
                            :error="searchError"
                            :busy-ids="busyIds"
                            :warnings="warnings"
                            can-open-related
                            @retry="retry"
                            @add="onQuickAdd"
                            @set-status="onSetStatus"
                            @remove="onRemove"
                            @open-related="openRelatedFromCard"
                        />
                    </SearchTab>

                    <MyListsTab
                        v-show="activeTab === 'lists'"
                        :items="listItems"
                        :list-status="listStatus"
                        :error-text="listErrorText"
                        :has-more="listHasMore"
                        :loading-more="listLoadingMore"
                        :filter-type="listFilterType"
                        :filter-status="listFilterStatus"
                        :busy-ids="listBusyIds"
                        :suggest-ids="listSuggestIds"
                        :warnings="listWarnings"
                        @update:filter-type="setListType"
                        @update:filter-status="setListStatus"
                        @load-more="loadMoreList"
                        @retry="retryList"
                        @increment="incrementRate"
                        @set-progress="setRateProgress"
                        @set-score="setRateScore"
                        @change-status="changeRateStatus"
                        @remove="removeRate"
                        @mark-completed="markRateCompleted"
                        @dismiss-suggest="dismissRateSuggest"
                        @open-related="openRelatedFromRow"
                    />

                    <CalendarTab
                        v-show="activeTab === 'calendar'"
                        :days="calendarDays"
                        :screen-status="calendarStatus"
                        :error-text="calendarErrorText"
                        @retry="retryCalendar"
                    />
                </div>

                <!-- v-if, not v-show: the overlay is entered rarely, and while
                     it is closed it must cost the popup nothing — neither a
                     row in the DOM nor a document keydown listener. -->
                <RelatedScreen
                    v-if="relatedTarget"
                    :target="relatedTarget"
                    :screen-status="relatedStatus"
                    :error-text="relatedErrorText"
                    :groups="relatedGroups"
                    :shown="relatedShown"
                    :total="relatedTotal"
                    :has-more="relatedHasMore"
                    :busy-ids="relatedBusyIds"
                    :warnings="relatedWarnings"
                    @close="closeRelated"
                    @retry="retryRelated"
                    @load-more="loadMoreRelated"
                    @add="quickAddRelated"
                    @set-status="setRelatedStatus"
                    @remove="removeRelated"
                />
            </div>

            <!-- :key re-mounts the toast, restarting its auto-close timer even
                 when the same text is shown twice in a row. -->
            <Toast
                v-if="toast"
                :key="toast.nonce"
                :text="toast.text"
                @closed="toast = null"
            />
        </template>

        <LoginScreen v-else />
    </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';
import CalendarTab from '@/src/components/CalendarTab.vue';
import LoginScreen from '@/src/components/LoginScreen.vue';
import MyListsTab from '@/src/components/MyListsTab.vue';
import RelatedScreen from '@/src/components/RelatedScreen.vue';
import SearchResults from '@/src/components/SearchResults.vue';
import SearchTab from '@/src/components/SearchTab.vue';
import TabBar from '@/src/components/TabBar.vue';
import type { TabId } from '@/src/components/TabBar.vue';
import Toast from '@/src/components/Toast.vue';
import UserHeader from '@/src/components/UserHeader.vue';
import { reportEvent } from '@/src/lib/analytics-report';
import { useAuth } from '@/src/composables/use-auth';
import { useCalendar } from '@/src/composables/use-calendar';
import { useLists } from '@/src/composables/use-lists';
import { useRelated } from '@/src/composables/use-related';
import type { RelatedTarget } from '@/src/composables/use-related';
import { useSearchScreen } from '@/src/composables/use-search-screen';
import type { RateRow, TitleCard } from '@/src/lib/api/types';
import {
    DEFAULT_SETTINGS,
    FALLBACK_TAB,
    getSession,
    getSettings,
    isPopupTab,
    removeSession,
    setSession,
} from '@/src/lib/storage';
import { apiErrorMessage } from '@/src/lib/i18n';

const { status, user, error } = useAuth();

// The nonce feeds :key so a repeated identical message still re-mounts the
// Toast and restarts its timer (a text-only watch would not fire).
const toast = ref<{ text: string; nonce: number } | null>(null);

function showToast(text: string): void {
    toast.value = { text, nonce: (toast.value?.nonce ?? 0) + 1 };
}

// Search session + the rate writes over its results, shared with the
// full-screen search page (Ф6-5).
const {
    query: searchQuery,
    searchType,
    status: searchStatus,
    items: searchItems,
    error: searchError,
    setQuery,
    startQuery,
    setType: setSearchType,
    retry,
    busyIds,
    warnings,
    openMenuKey,
    onSetStatus,
    onQuickAdd,
    onRemove,
} = useSearchScreen(showToast);

const {
    items: listItems,
    listStatus,
    errorText: listErrorText,
    hasMore: listHasMore,
    loadingMore: listLoadingMore,
    filterType: listFilterType,
    filterStatus: listFilterStatus,
    busyIds: listBusyIds,
    suggestIds: listSuggestIds,
    warnings: listWarnings,
    activate: activateLists,
    loadMore: loadMoreList,
    retry: retryList,
    setFilterType: setListType,
    setFilterStatus: setListStatus,
    increment: incrementRate,
    setProgress: setRateProgress,
    setScore: setRateScore,
    markCompleted: markRateCompleted,
    changeStatus: changeRateStatus,
    removeRate,
    dismissSuggest: dismissRateSuggest,
} = useLists(showToast);

// Ongoings calendar (US-9). Read-only, so the composable hands over rows and
// states only — no write callbacks, no toast.
const {
    days: calendarDays,
    screenStatus: calendarStatus,
    errorText: calendarErrorText,
    activate: activateCalendar,
    retry: retryCalendar,
} = useCalendar();

// «Связанные» (US-11): an overlay over the tabs, opened from a search card or a
// list row. Nothing here runs until one of them is clicked — the composable
// sends its single request on open() and never on mount, so a popup that never
// visits the screen still costs 0 requests (docs/06, DoD of phase 12).
const {
    target: relatedTarget,
    screenStatus: relatedStatus,
    errorText: relatedErrorText,
    groups: relatedGroups,
    shown: relatedShown,
    total: relatedTotal,
    hasMore: relatedHasMore,
    busyIds: relatedBusyIds,
    warnings: relatedWarnings,
    open: openRelated,
    close: closeRelatedScreen,
    loadMore: loadMoreRelated,
    retry: retryRelated,
    onSetStatus: setRelatedStatus,
    onQuickAdd: quickAddRelated,
    onRemove: removeRelated,
} = useRelated(showToast);

// The control the overlay was opened from, remembered so the caret can go back
// to it (docs/06, Ф12-8). It is read off the focused element rather than passed
// down, because the two entry points of one row are two different elements: the
// word in the line focuses itself by being clicked, and the StatusMenu item
// hands the focus to its trigger before emitting (TitleCard/RateRow.onRelated).
// Structural typing instead of `instanceof HTMLElement`: the component tests run
// without a DOM, where that global does not exist.
let relatedReturnFocus: { focus: () => void } | null = null;

function focusableActiveElement(): { focus: () => void } | null {
    const active: unknown = typeof document === 'undefined' ? null : document.activeElement;
    const candidate = active as { focus?: unknown } | null;
    return typeof candidate?.focus === 'function' ? (candidate as { focus: () => void }) : null;
}

function openRelatedScreen(target: RelatedTarget): void {
    relatedReturnFocus = focusableActiveElement();
    openRelated(target);
}

// A search card: its `id` is the title id the screen asks about.
function openRelatedFromCard(card: TitleCard): void {
    openRelatedScreen({
        targetId: card.id,
        targetType: card.targetType,
        name: card.name,
        russian: card.russian,
    });
}

// A list row: `targetId` is the title, `rateId` is my rate over it — the screen
// wants the former.
function openRelatedFromRow(row: RateRow): void {
    openRelatedScreen({
        targetId: row.targetId,
        targetType: row.targetType,
        name: row.name,
        russian: row.russian,
    });
}

function closeRelated(): void {
    closeRelatedScreen();
    const control = relatedReturnFocus;
    relatedReturnFocus = null;
    // After the overlay is gone: the control is behind it until Vue has patched
    // the tree, and focusing a covered element would scroll the tab underneath.
    void nextTick(() => control?.focus());
}

// Active top-level tab (docs/05). Which tab opens is the `startTab` setting:
// 'last' restores session.lastTab, a tab name pins that tab (Ф6-20, Ф7-9). The
// cache is written on every switch either way — 'last' lives on it.
const activeTab = ref<TabId>(FALLBACK_TAB);
// The async start-tab restore must not override a tab the user already picked.
let tabTouched = false;

// Query handed over by the context menu (Ф5-11), pending until it runs signed
// in. A real login always passes through the 'anonymous' gate, which is what
// tells a run that left signed out — doomed — from one merely racing the auth
// read on a normal open.
let pendingQuery: string | null = null;
let sawAnonymous = false;

onMounted(async () => {
    await resolveStartTab();
    // Ф10-11: the tab the popup actually landed on — after the context-menu
    // handover, the restored session tab and the startTab setting have all had
    // their say. Reported once per open and never on a later tab switch: the
    // question is what people open the popup for, not how they browse it.
    reportEvent({ name: 'popup_opened', params: { tab: activeTab.value } });
});

async function resolveStartTab(): Promise<void> {
    // All three reads are awaited as one, so the outcome cannot depend on which
    // storage promise settles first: a query handed over by the context menu
    // (Ф5-11) always beats both the restored tab and the startTab setting.
    // Never rejects (same rule as src/lib/theme.ts): a failed storage read must
    // not break the open — the popup then keeps the tab it started on and the
    // documented defaults, instead of dying on an unhandled rejection.
    const [pending, lastTab, settings] = await Promise.all([
        getSession('pendingSearch'),
        getSession('lastTab'),
        getSettings(),
    ]).catch(() => [undefined, undefined, DEFAULT_SETTINGS] as const);
    if (pending) {
        // Kept in storage until the search actually runs signed in (see the
        // watcher below): signing in opens the OAuth window, Chrome closes the
        // popup with it, and a key already dropped here would leave the user
        // with nothing to reopen into.
        pendingQuery = pending.query;
        // tabTouched is not consulted: the popup exists because of this query,
        // and the read lands while the auth gate still shows the skeleton, so
        // there is no tab the user could have picked before it.
        activeTab.value = 'search';
        // The selection carries no type, so the search runs with the user's
        // default type instead of a «Ранобэ» restored from the session cache,
        // which would silently answer an anime title with 0 results (docs/05
        // §Поиск из контекстного меню; until Ф6-20 the type was pinned to
        // 'anime' — the setting is the explicit intent and outranks it).
        // Clearing the query first keeps setType from dispatching a request for
        // the previous session's query — the one request of this open belongs
        // to startQuery.
        setQuery('');
        setSearchType(settings.defaultSearchType);
        startQuery(pending.query);
        return;
    }
    if (tabTouched) {
        return; // the user picked a tab while these reads were in flight
    }
    if (settings.startTab === 'last') {
        // A cached tab from another build is dropped instead of restored: the
        // popup then simply stays on the tab it started on (FALLBACK_TAB),
        // never on none (Ф7-9). getSettings() applies the same guard to the
        // setting itself.
        if (isPopupTab(lastTab)) {
            activeTab.value = lastTab;
        }
        return;
    }
    activeTab.value = settings.startTab;
}

// The handed-over query is consumed only once it has run with a token: while
// the user is signed out the key stays in storage, so after the login (which
// closes this popup along the way) the next open replays the search instead of
// losing it. Mirrors the replay in entrypoints/search/SearchPage.vue.
watch(status, (next) => {
    if (next === 'anonymous') {
        sawAnonymous = true;
        return;
    }
    if (next !== 'authorized' || pendingQuery === null) {
        return;
    }
    const query = pendingQuery;
    pendingQuery = null;
    // A failed remove costs one replay on the next open, not the search itself.
    removeSession('pendingSearch').catch(() => {});
    // Replayed: a run that came back unauthorized, and a run still in flight if
    // it left while signed out (startQuery bumps the request id, so the late
    // answer of the doomed one is dropped). A run racing the auth read with a
    // valid token must not be sent twice.
    if (sawAnonymous || searchError.value?.kind === 'unauthorized') {
        startQuery(query);
    }
});

function selectTab(tab: TabId): void {
    tabTouched = true;
    activeTab.value = tab;
    void setSession('lastTab', tab);
}

// Lazy first-page load: only once the user is authorized AND the data tab is
// actually shown (docs/05 — no blocking requests at popup open). Re-fires on
// every later show of the tab: activate() refreshes each time so site-side
// changes surface (docs/06, дополнение фазы 3). The calendar rides the same
// watch — a popup opened on «Поиске» must cost it nothing (docs/06, phase 7).
watch(
    [status, activeTab],
    ([authStatus, tab]) => {
        if (authStatus !== 'authorized') {
            return;
        }
        if (tab === 'lists') {
            activateLists();
        } else if (tab === 'calendar') {
            activateCalendar();
        }
    },
    { immediate: true },
);
</script>

<style scoped lang="scss">
.app {
    /* Square shell: Chrome fills the popup window corners itself, so a radius
       here only draws the window fill inside the rounding instead of cutting
       it out (owner decision 2026-07-27 — the rounded shell was reverted).
       The background lives on body, not here. */
    display: flex;
    flex-direction: column;
    height: 100%;
}

/* Positioning context of the «Связанные» overlay (Ф12): it is `position:
   absolute; inset: 0` inside this box, so it covers the tab row and the tab
   content and leaves the header above it — ⚙ and «Выйти» must stay reachable
   from every screen (design card screens/related). Otherwise the same flex
   column the tabs were direct children of, so the layout is unchanged.
   Nothing here or above may get a `transform`: it would become the containing
   block of the fixed StatusMenu and take every popover with it
   (src/composables/use-popover-position.ts). */
.app__body {
    position: relative;
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
}

/* Carries what the tab row and the tab content used to get from .app__body, so
   wrapping them for `inert` costs no layout change: the flex column is simply
   one level deeper, and .app__body keeps only the positioning context the
   overlay needs. */
.app__tabs {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
}

.app__error {
    margin: 0;
    padding: 8px 12px;
    border-bottom: 1px solid var(--color-border);
    font-size: 13px;
    color: var(--color-danger);
}

/* --- Loading skeleton: mirrors the header + a few content rows --- */

.app-skeleton {
    display: flex;
    flex-direction: column;
}

.app-skeleton__header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--color-border);
}

.app-skeleton__body {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px 12px;
}

.app-skeleton__avatar {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--color-surface);
}

.app-skeleton__line {
    height: 12px;
    border-radius: 6px;
    background: var(--color-surface);
    animation: skeleton-pulse 1.4s ease-in-out infinite;
}

.app-skeleton__line--nickname {
    width: 120px;
}

.app-skeleton__line--short {
    width: 60%;
}

@keyframes skeleton-pulse {
    0%,
    100% {
        opacity: 1;
    }

    50% {
        opacity: 0.55;
    }
}

@media (prefers-reduced-motion: reduce) {
    .app-skeleton__line {
        animation: none;
    }
}
</style>
