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
                        :menu-open="openMenuCardId === card.id"
                        @update:menu-open="openMenuCardId = $event ? card.id : null"
                        @add="onCardAction"
                        @set-status="onCardAction"
                        @remove="onCardAction"
                    />
                </template>
            </SearchTab>

            <Toast
                v-if="toastText"
                :text="toastText"
                @closed="toastText = null"
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
import { useSearch } from '@/src/composables/use-search';
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

// Toast is shown by rates.* failures (Ф2-7); stays hidden until then.
const toastText = ref<string | null>(null);

// At most one open StatusMenu across the list: the id of the card that owns it.
const openMenuCardId = ref<string | null>(null);

// TODO(Ф2-7): TitleCard actions (add / set-status / remove) call rates.* via
// messaging with optimistic updates + rollback toast. No-op until then.
function onCardAction(): void {
    // wired in Ф2-7
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
