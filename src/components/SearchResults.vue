<template>
    <SkeletonList v-if="status === 'loading'" />
    <EmptyState
        v-else-if="status === 'idle'"
        :text="i18n.search.emptyHint"
    />
    <EmptyState
        v-else-if="status === 'empty'"
        :text="i18n.search.noResults"
    />
    <ErrorState
        v-else-if="status === 'error'"
        :text="error ? apiErrorMessage(error) : i18n.errors.internal"
        @retry="emit('retry')"
    />
    <template v-else>
        <TitleCard
            v-for="card in items"
            :key="rateKey(card)"
            :card="card"
            :busy="busyIds.has(rateKey(card))"
            :warning="warnings.get(rateKey(card)) ?? null"
            :menu-open="openMenuKey === rateKey(card)"
            @update:menu-open="emit('update:openMenuKey', $event ? rateKey(card) : null)"
            @add="emit('add', card)"
            @set-status="emit('set-status', card, $event)"
            @remove="emit('remove', card)"
        />
    </template>
</template>

<script setup lang="ts">
import EmptyState from '@/src/components/EmptyState.vue';
import ErrorState from '@/src/components/ErrorState.vue';
import SkeletonList from '@/src/components/SkeletonList.vue';
import TitleCard from '@/src/components/TitleCard.vue';
import { rateKey } from '@/src/composables/use-rates';
import type { SearchStatus } from '@/src/composables/use-search';
import type { ApiError, TitleCard as TitleCardData, UserRateStatus } from '@/src/lib/api/types';
import { apiErrorMessage, i18n } from '@/src/lib/i18n';

// The search result list with all its data states (docs/05), shared by the
// popup and the full-screen search page (Ф6-5). Presentational only: data and
// mutations come from use-search-screen through props/emits.
//
// Deliberately rootless (a fragment): both owners put this list straight into
// their own scroll/box container, whose styling addresses the cards as direct
// children — a wrapper element here would break that layout in both.
//
// It has no styles of its own, so it takes no layout variant (the scroll
// container lives in SearchTab). What an owner may tune is the look of the data
// states rendered below; the handles belong to those components and are set on
// the owner's own container, which they inherit from (Ф6-6):
//   --state-min-height           EmptyState / ErrorState height
//   --skeleton-last-row-border   SkeletonList closing separator
//
// Ф4-6b invariant: rateKey(card) — the composite `${targetType}:${id}` key of
// busyIds/warnings/openMenuKey — is computed HERE and nowhere else. Anime and
// manga ids are independent sequences, so a bare-id key silently locks (or
// warns on) the wrong title; keeping the one call site is what keeps the two
// screens from drifting apart.
//
// Props:
//   items        — cards of the current search
//   status       — which data state to render (idle|loading|data|empty|error)
//   error        — failure behind the 'error' state (falls back to a generic text)
//   busyIds      — rateKeys with a write in flight (locks that card)
//   warnings     — rateKey -> inline warning text (revoked edit access)
//   openMenuKey  — rateKey of the card whose status menu is open, at most one
//
// Emits:
//   retry                      — error state's retry button
//   update:openMenuKey(key)    — menu opened on a card / closed
//   add(card)                  — one-click add (status = the quickStatus setting)
//   set-status(card, status)   — status picked in the menu
//   remove(card)               — removed from my list
withDefaults(
    defineProps<{
        items: TitleCardData[];
        status: SearchStatus;
        error?: ApiError;
        busyIds?: ReadonlySet<string>;
        warnings?: ReadonlyMap<string, string>;
        openMenuKey: string | null;
    }>(),
    {
        error: undefined,
        busyIds: () => new Set(),
        warnings: () => new Map(),
    },
);

const emit = defineEmits<{
    retry: [];
    'update:openMenuKey': [key: string | null];
    add: [card: TitleCardData];
    'set-status': [card: TitleCardData, status: UserRateStatus];
    remove: [card: TitleCardData];
}>();
</script>
