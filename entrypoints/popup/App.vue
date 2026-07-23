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

            <SearchTab
                :model-value="searchQuery"
                @update:model-value="setQuery"
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
                        :key="card.id"
                        :card="card"
                        :busy="busyIds.has(card.id)"
                        :warning="warnings.get(card.id) ?? null"
                        :menu-open="openMenuCardId === card.id"
                        @update:menu-open="openMenuCardId = $event ? card.id : null"
                        @add="onSetStatus(card, 'planned')"
                        @set-status="onSetStatus(card, $event)"
                        @remove="onRemove(card)"
                    />
                </template>
            </SearchTab>

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
import { ref } from 'vue';
import EmptyState from '@/src/components/EmptyState.vue';
import ErrorState from '@/src/components/ErrorState.vue';
import LoginScreen from '@/src/components/LoginScreen.vue';
import SearchTab from '@/src/components/SearchTab.vue';
import SkeletonList from '@/src/components/SkeletonList.vue';
import TitleCard from '@/src/components/TitleCard.vue';
import Toast from '@/src/components/Toast.vue';
import UserHeader from '@/src/components/UserHeader.vue';
import { useAuth } from '@/src/composables/use-auth';
import { useRates } from '@/src/composables/use-rates';
import { useSearch } from '@/src/composables/use-search';
import type { TitleCard as TitleCardData, UserRateStatus } from '@/src/lib/api/types';
import { apiErrorMessage, i18n } from '@/src/lib/i18n';

const { status, user, error } = useAuth();

const {
    query: searchQuery,
    status: searchStatus,
    items: searchItems,
    error: searchError,
    setQuery,
    retry,
} = useSearch();

// The nonce feeds :key so a repeated identical message still re-mounts the
// Toast and restarts its timer (a text-only watch would not fire).
const toast = ref<{ text: string; nonce: number } | null>(null);

function showToast(text: string): void {
    toast.value = { text, nonce: (toast.value?.nonce ?? 0) + 1 };
}

const { busyIds, warnings, performAction } = useRates(searchItems, showToast);

// At most one open StatusMenu across the list: the id of the card that owns it.
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
    display: flex;
    flex-direction: column;
    height: 100%;
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
