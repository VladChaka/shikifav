<template>
    <div class="page">
        <!-- Auth state is being read from storage: same calm skeleton as the
             popup instead of flashing the login screen (docs/05-ui.md). -->
        <template v-if="status === 'loading'">
            <div
                class="page__bar"
                aria-hidden="true"
            >
                <div class="page__bar-inner page-skeleton__header">
                    <span class="page-skeleton__avatar"></span>
                    <span class="page-skeleton__line page-skeleton__line--nickname"></span>
                </div>
            </div>
            <div
                class="page__content page__content--skeleton"
                aria-hidden="true"
            >
                <span class="page-skeleton__line"></span>
                <span class="page-skeleton__line"></span>
                <span class="page-skeleton__line page-skeleton__line--short"></span>
            </div>
        </template>

        <template v-else-if="status === 'authorized' && user">
            <!-- Full-width bar, content aligned to the 720px column. -->
            <div class="page__bar">
                <div class="page__bar-inner">
                    <UserHeader :user="user" />
                </div>
            </div>

            <main class="page__content">
                <!-- Only a failed logout can set the error while authorized. -->
                <p
                    v-if="error"
                    class="page__error"
                    role="alert"
                >
                    {{ apiErrorMessage(error) }}
                </p>

                <SearchTab
                    ref="searchTab"
                    :model-value="searchQuery"
                    :search-type="searchType"
                    @update:model-value="setQuery"
                    @update:search-type="setSearchType"
                >
                    <div class="page__results">
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
                            :text="
                                searchError ? apiErrorMessage(searchError) : i18n.errors.internal
                            "
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
                    </div>
                </SearchTab>
            </main>

            <!-- :key re-mounts the toast, restarting its auto-close timer even
                 when the same text is shown twice in a row. -->
            <Toast
                v-if="toast"
                :key="toast.nonce"
                :text="toast.text"
                @closed="toast = null"
            />
        </template>

        <div
            v-else
            class="page__login"
        >
            <LoginScreen />
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import EmptyState from '@/src/components/EmptyState.vue';
import ErrorState from '@/src/components/ErrorState.vue';
import LoginScreen from '@/src/components/LoginScreen.vue';
import SearchTab from '@/src/components/SearchTab.vue';
import SkeletonList from '@/src/components/SkeletonList.vue';
import TitleCard from '@/src/components/TitleCard.vue';
import Toast from '@/src/components/Toast.vue';
import UserHeader from '@/src/components/UserHeader.vue';
import { useAuth } from '@/src/composables/use-auth';
import { rateKey, useRates } from '@/src/composables/use-rates';
import { useSearch } from '@/src/composables/use-search';
import type { TitleCard as TitleCardData, UserRateStatus } from '@/src/lib/api/types';
import { apiErrorMessage, i18n } from '@/src/lib/i18n';

// Full-screen search page opened by the context menu as search.html?q=…
// (docs/05). The query is parsed in main.ts and handed over as a prop: the page
// itself never touches window/location.
const props = defineProps<{ initialQuery: string }>();

const { status, user, error } = useAuth();

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
} = useSearch();

// The query is fired synchronously, without waiting for auth.getState: the
// token lives in storage and background attaches it, so an already signed-in
// user gets results at first paint. search.titles always goes out with a
// Bearer token though, so a run started while signed out comes back with an
// error — pendingInitial remembers such a run and replays it once after login.
let pendingInitial = false;
// A real login always passes through the 'anonymous' gate (that is the only
// state showing LoginScreen), so this flag separates a run that started signed
// out — doomed, whatever its current state — from one merely racing the auth
// read on a normal open.
let sawAnonymous = false;

if (props.initialQuery !== '') {
    // Always true here: the page is fresh, so useAuth is still 'loading' — the
    // state is only ever known after auth.getState answers.
    pendingInitial = true;
    startQuery(props.initialQuery);
}

watch(status, (next) => {
    if (next === 'anonymous') {
        sawAnonymous = true;
        return;
    }
    if (next !== 'authorized' || !pendingInitial) {
        return;
    }
    pendingInitial = false;
    // Replayed: a run that came back unauthorized, and a run still in flight if
    // it left while signed out (it carries no token and comes back 401 —
    // startQuery bumps the request id, so that late answer is dropped). A run
    // that succeeded, or one racing the auth read with a valid token, must not
    // be sent twice; a network/rate-limit failure belongs to «Повторить», the
    // login has nothing to do with it.
    if (searchError.value?.kind === 'unauthorized' || sawAnonymous) {
        startQuery(props.initialQuery);
    }
});

// Opened without ?q=: put the caret in the field. The field appears only after
// the auth gate resolves, so the focus waits for the SearchTab instance instead
// of firing on page mount.
const searchTab = ref<InstanceType<typeof SearchTab> | null>(null);

// immediate covers the day the auth gate can resolve before the first render:
// today SearchTab is never mounted at that point, and the focus would silently
// stop working if that ever changed.
watch(
    searchTab,
    (tab) => {
        if (tab && props.initialQuery === '') {
            tab.focus();
        }
    },
    { immediate: true },
);

// The nonce feeds :key so a repeated identical message still re-mounts the
// Toast and restarts its timer (a text-only watch would not fire).
const toast = ref<{ text: string; nonce: number } | null>(null);

function showToast(text: string): void {
    toast.value = { text, nonce: (toast.value?.nonce ?? 0) + 1 };
}

const { busyIds, warnings, performAction } = useRates(searchItems, showToast);

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
/* Design card screens/search-page: the page fills the tab (no shell border, no
   radius, no fixed size); the header spans the full width while its content and
   the results share one 720px column. */
.page {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
}

.page__bar {
    border-bottom: 1px solid var(--color-border);
}

.page__bar-inner {
    max-width: 720px;
    margin: 0 auto;
}

/* UserHeader carries its own padding and bottom border (it is the popup shell
   header). On this page the border belongs to the full-width bar, and the
   horizontal padding must match the content column — overridden here so the
   shared component stays untouched. */
.page__bar-inner :deep(.header) {
    padding-right: 24px;
    padding-left: 24px;
    border-bottom: 0;
}

.page__content {
    width: 100%;
    max-width: 720px;
    margin: 0 auto;
    padding: 20px 24px 28px;
}

/* Same reason as the header: the popup-sized field frame is replaced by the
   column rhythm — the divider under the field is the results box border here. */
.page__content :deep(.search__field) {
    padding: 0 0 14px;
    border-bottom: 0;
}

/* In the popup the results area is the scroll container of a fixed-size window;
   the page scrolls as a whole document instead, and an inner scroller would clip
   the status menu of the bottom cards. */
.page__content :deep(.search__results) {
    overflow: visible;
}

.page__error {
    margin: 0 0 14px;
    font-size: 13px;
    color: var(--color-danger);
}

/* Results (and the skeleton/empty/error states) live in one bordered box.
   Deliberately without `overflow: hidden`: the rows are transparent and only
   draw bottom borders, so nothing needs clipping to keep the corners clean,
   while the StatusMenu of the last card has to hang out of the box. */
.page__results {
    border: 1px solid var(--color-border);
    border-radius: 10px;

    /* The box draws the closing line, the last row must not double it — be it
       a card (its own root) or a skeleton row (nested inside SkeletonList,
       which draws the borders on the rows and not on its root). */
    > :last-child {
        border-bottom: 0;
    }

    :deep(.skeleton__row:last-child) {
        border-bottom: 0;
    }

    /* The 120px popup placeholders read as a sliver in a 672px column. */
    :deep(.empty),
    :deep(.error) {
        min-height: 240px;
    }
}

/* The toast is fixed 12px off both popup edges; on a full-width tab that band
   stretches across the screen, so here it is clamped to the content column and
   centred with it (the insets stay the fallback for narrow windows). */
.page :deep(.toast) {
    width: min(100% - 24px, 672px);
    margin-inline: auto;
}

.page__login {
    display: flex;
    flex: 1;
    justify-content: center;
    width: 100%;
    max-width: 720px;
    margin: 0 auto;
    padding: 0 24px;
}

/* --- Loading skeleton: mirrors the header bar + a few content rows --- */

/* Same 10/28/10 rhythm as UserHeader inside the same bar, so the real header
   lands exactly where the placeholder was — no jump when auth resolves. */
.page-skeleton__header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 24px;
}

.page__content--skeleton {
    display: flex;
    flex-direction: column;
    gap: 14px;
}

.page-skeleton__avatar {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--color-surface);
}

.page-skeleton__line {
    height: 12px;
    border-radius: 6px;
    background: var(--color-surface);
    animation: skeleton-pulse 1.4s ease-in-out infinite;
}

.page-skeleton__line--nickname {
    width: 120px;
}

.page-skeleton__line--short {
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
    .page-skeleton__line {
        animation: none;
    }
}
</style>
