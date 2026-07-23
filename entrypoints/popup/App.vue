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

            <!-- TEMPORARY (Ф2-5): dev-only switcher to reach every screen state
                 visually. REMOVE in Ф2-6 together with search-stubs.ts. -->
            <div
                v-if="isDev"
                class="app__demo"
            >
                <button
                    v-for="view in DEMO_VIEWS"
                    :key="view.id"
                    class="app__demo-button"
                    :class="{ 'app__demo-button--active': demoView === view.id }"
                    type="button"
                    @click="demoView = view.id"
                >
                    {{ view.label }}
                </button>
                <button
                    class="app__demo-button"
                    type="button"
                    @click="toastText = i18n.errors.api"
                >
                    {{ DEMO_TOAST_LABEL }}
                </button>
            </div>

            <SearchTab v-model="query">
                <SkeletonList v-if="demoView === 'loading'" />
                <EmptyState
                    v-else-if="demoView === 'empty-hint'"
                    :text="i18n.search.emptyHint"
                />
                <EmptyState
                    v-else-if="demoView === 'no-results'"
                    :text="i18n.search.noResults"
                />
                <ErrorState
                    v-else-if="demoView === 'error'"
                    :text="i18n.errors.network"
                    @retry="onDemoAction"
                />
                <template v-else>
                    <TitleCard
                        v-for="card in STUB_CARDS"
                        :key="card.id"
                        :card="card"
                        :busy="card.id === STUB_BUSY_ID"
                        :warning="card.id === STUB_WARNING_ID ? i18n.errors.editForbidden : null"
                        @add="onDemoAction"
                        @set-status="onDemoAction"
                        @remove="onDemoAction"
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
import { apiErrorMessage, i18n } from '@/src/lib/i18n';
// TEMPORARY (Ф2-5): stubs feed the static layout, delete in Ф2-6.
import {
    DEMO_TOAST_LABEL,
    DEMO_VIEWS,
    STUB_BUSY_ID,
    STUB_CARDS,
    STUB_WARNING_ID,
    type DemoView,
} from './search-stubs';

const { status, user, error } = useAuth();

// Search query is owned here; useSearch (Ф2-6) will take it over.
const query = ref('');

const toastText = ref<string | null>(null);

// TEMPORARY (Ф2-5): demo screen state + dev flag, remove in Ф2-6.
const isDev = import.meta.env.DEV;
const demoView = ref<DemoView>('results');

// Integration point for Ф2-6/Ф2-7: TitleCard events (add / set-status /
// remove) and ErrorState retry will call rates.* via messaging with
// optimistic updates. No-op while the screen is static.
function onDemoAction(): void {
    // wired in Ф2-6
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

/* TEMPORARY (Ф2-5): dev-only demo switcher, remove in Ф2-6. */
.app__demo {
    display: flex;
    flex-shrink: 0;
    flex-wrap: wrap;
    gap: 4px;
    padding: 4px 12px;
    border-bottom: 1px dashed var(--color-border);
}

.app__demo-button {
    padding: 1px 6px;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    background: transparent;
    color: var(--color-fg-muted);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
}

.app__demo-button--active {
    border-color: var(--color-accent);
    color: var(--color-accent);
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
