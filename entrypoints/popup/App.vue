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
                <SkeletonList v-if="searchStatus === 'loading'" />
                <EmptyState
                    v-else-if="searchStatus === 'idle'"
                    :text="i18n.search.emptyHint"
                />
                <EmptyState
                    v-else-if="searchStatus === 'empty'"
                    :text="i18n.search.noResults"
                />
                <ErrorState
                    v-else-if="searchStatus === 'error'"
                    :text="searchError ? apiErrorMessage(searchError) : i18n.errors.internal"
                    @retry="retry"
                />
                <template v-else>
                    <TitleCard
                        v-for="card in searchItems"
                        :key="rateKey(card)"
                        :card="card"
                        :busy="busyIds.has(rateKey(card))"
                        :warning="warnings.get(rateKey(card)) ?? null"
                        :menu-open="openMenuCardId === rateKey(card)"
                        @update:menu-open="openMenuCardId = $event ? rateKey(card) : null"
                        @add="onSetStatus(card, 'planned')"
                        @set-status="onSetStatus(card, $event)"
                        @remove="onRemove(card)"
                    />
                </template>
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
                @set-score="setRateScore"
                @change-status="changeRateStatus"
                @remove="removeRate"
                @mark-completed="markRateCompleted"
                @dismiss-suggest="dismissRateSuggest"
            />

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
import { onMounted, ref, watch } from 'vue';
import EmptyState from '@/src/components/EmptyState.vue';
import ErrorState from '@/src/components/ErrorState.vue';
import LoginScreen from '@/src/components/LoginScreen.vue';
import MyListsTab from '@/src/components/MyListsTab.vue';
import SearchTab from '@/src/components/SearchTab.vue';
import SkeletonList from '@/src/components/SkeletonList.vue';
import TabBar from '@/src/components/TabBar.vue';
import type { TabId } from '@/src/components/TabBar.vue';
import TitleCard from '@/src/components/TitleCard.vue';
import Toast from '@/src/components/Toast.vue';
import UserHeader from '@/src/components/UserHeader.vue';
import { useAuth } from '@/src/composables/use-auth';
import { useLists } from '@/src/composables/use-lists';
import { rateKey, useRates } from '@/src/composables/use-rates';
import { useSearch } from '@/src/composables/use-search';
import type { TitleCard as TitleCardData, UserRateStatus } from '@/src/lib/api/types';
import { getSession, setSession } from '@/src/lib/storage';
import { apiErrorMessage, i18n } from '@/src/lib/i18n';

const { status, user, error } = useAuth();

const {
    query: searchQuery,
    searchType,
    status: searchStatus,
    items: searchItems,
    error: searchError,
    setQuery,
    setType: setSearchType,
    retry,
} = useSearch();

// The nonce feeds :key so a repeated identical message still re-mounts the
// Toast and restarts its timer (a text-only watch would not fire).
const toast = ref<{ text: string; nonce: number } | null>(null);

function showToast(text: string): void {
    toast.value = { text, nonce: (toast.value?.nonce ?? 0) + 1 };
}

const { busyIds, warnings, performAction } = useRates(searchItems, showToast);

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
    setScore: setRateScore,
    markCompleted: markRateCompleted,
    changeStatus: changeRateStatus,
    removeRate,
    dismissSuggest: dismissRateSuggest,
} = useLists(showToast);

// Active top-level tab (docs/05). Restored from session on open and persisted on
// every switch, so the popup reopens on the last used tab.
const activeTab = ref<TabId>('search');
// The async lastTab restore must not override a tab the user already picked.
let tabTouched = false;

onMounted(async () => {
    const lastTab = await getSession('lastTab');
    if (lastTab && !tabTouched) {
        activeTab.value = lastTab;
    }
});

function selectTab(tab: TabId): void {
    tabTouched = true;
    activeTab.value = tab;
    void setSession('lastTab', tab);
}

// Lazy first-page load: only once the user is authorized AND the "Мои списки"
// tab is actually shown (docs/05 — no blocking requests at popup open).
// Re-fires on every later show of the tab: activate() refreshes the list each
// time so site-side changes surface (docs/06, дополнение фазы 3).
watch(
    [status, activeTab],
    ([authStatus, tab]) => {
        if (authStatus === 'authorized' && tab === 'lists') {
            activateLists();
        }
    },
    { immediate: true },
);

// At most one open StatusMenu across the list: the rateKey of the card that
// owns it (id alone can collide between anime and manga of the same id).
const openMenuCardId = ref<string | null>(null);

// A card outside my list creates a rate, one inside updates its status (US-3).
function onSetStatus(card: TitleCardData, status: UserRateStatus): void {
    void performAction(
        card,
        card.userRate === null ? { type: 'create', status } : { type: 'update', status },
    );
}

function onRemove(card: TitleCardData): void {
    void performAction(card, { type: 'delete' });
}
</script>

<style scoped lang="scss">
.app {
    /* Rounded popup shell (design screens/search.html, UX-2): the radius +
       overflow clip keep the header/content inside the corners; the app owns
       the background — body stays transparent so the corners show the browser
       window fill. Chrome draws the popup drop shadow itself, so the design's
       box-shadow is intentionally not reproduced here. */
    display: flex;
    flex-direction: column;
    overflow: hidden;
    height: 100%;
    border: 1px solid var(--color-border);
    border-radius: 14px;
    background: var(--color-bg);
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
