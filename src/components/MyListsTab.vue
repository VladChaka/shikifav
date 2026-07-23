<template>
    <section class="lists">
        <div class="lists__filters">
            <!-- Phase 3 is anime-only: Манга/Ранобэ are disabled options (phase 4). -->
            <select
                class="lists__select"
                :value="filterType"
                :aria-label="i18n.lists.typeFilterLabel"
                @change="onTypeChange"
            >
                <option value="anime">{{ i18n.lists.types.anime }}</option>
                <option
                    value="manga"
                    disabled
                >
                    {{ i18n.lists.types.manga }}
                </option>
                <option
                    value="ranobe"
                    disabled
                >
                    {{ i18n.lists.types.ranobe }}
                </option>
            </select>
            <select
                class="lists__select"
                :value="filterStatus"
                :aria-label="i18n.lists.statusFilterLabel"
                @change="onStatusChange"
            >
                <option
                    v-for="s in STATUSES"
                    :key="s"
                    :value="s"
                >
                    {{ statusLabel(s) }}
                </option>
            </select>
        </div>

        <div class="lists__results">
            <SkeletonList v-if="listStatus === 'skeleton'" />
            <EmptyState
                v-else-if="listStatus === 'empty'"
                :text="i18n.lists.empty"
            />
            <ErrorState
                v-else-if="listStatus === 'error'"
                :text="errorText ?? i18n.errors.internal"
                @retry="emit('retry')"
            />
            <template v-else>
                <RateRow
                    v-for="row in items"
                    :key="row.rateId"
                    :rate="row"
                    :busy="busyIds.has(row.rateId)"
                    :suggest-completed="suggestIds.has(row.rateId)"
                    :score-open="openScoreId === row.rateId"
                    :warning="warnings.get(row.rateId) ?? null"
                    @increment="emit('increment', row)"
                    @set-score="emit('set-score', row, $event)"
                    @mark-completed="emit('mark-completed', row)"
                    @dismiss-suggest="emit('dismiss-suggest', row)"
                    @update:score-open="openScoreId = $event ? row.rateId : null"
                />
                <div
                    v-if="hasMore"
                    class="lists__more"
                >
                    <button
                        class="lists__more-btn"
                        type="button"
                        :disabled="loadingMore"
                        @click="emit('load-more')"
                    >
                        {{ loadingMore ? i18n.lists.loadingMore : i18n.lists.loadMore }}
                    </button>
                </div>
            </template>
        </div>
    </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import EmptyState from '@/src/components/EmptyState.vue';
import ErrorState from '@/src/components/ErrorState.vue';
import RateRow from '@/src/components/RateRow.vue';
import SkeletonList from '@/src/components/SkeletonList.vue';
import type { RateRow as RateRowData, SearchType, UserRateStatus } from '@/src/lib/api/types';
import { i18n, statusLabel } from '@/src/lib/i18n';

// "Мои списки" tab frame (US-4/5/6, docs/05): type + status filters, the row
// list with its data states, and "Ещё" pagination. Presentational only — data
// and mutations come from use-lists (Ф3-4) through props/emits. The only local
// state is which row's score picker is open (transient view state).
//
// Props (fed by use-lists):
//   items         — rows for the current filter
//   listStatus    — which data state to render (skeleton|data|empty|error)
//   errorText     — message for the error state (falls back to a generic one)
//   hasMore       — another page exists → show "Ещё"
//   loadingMore   — the next page is loading → "Ещё" is disabled/labelled
//   filterType    — selected type; phase 3 forces 'anime' (Манга/Ранобэ disabled)
//   filterStatus  — selected status; use-lists defaults it to 'watching' (docs/05)
//   busyIds       — rateIds with a write in flight (locks that row)
//   suggestIds    — rateIds showing the "перевести в «Просмотрено»?" offer
//   warnings      — rateId -> inline warning text (revoked edit access)
//
// Emits:
//   update:filterType(type) / update:filterStatus(status) — filter changed
//   load-more / retry                                      — pagination / error retry
//   increment(row) / set-score(row, value) /
//   mark-completed(row) / dismiss-suggest(row)             — row actions, tagged
//                                                            with their RateRow
const props = withDefaults(
    defineProps<{
        items: RateRowData[];
        listStatus: 'skeleton' | 'data' | 'empty' | 'error';
        errorText?: string;
        hasMore: boolean;
        loadingMore: boolean;
        filterType: SearchType;
        filterStatus: UserRateStatus;
        busyIds?: ReadonlySet<string>;
        suggestIds?: ReadonlySet<string>;
        warnings?: ReadonlyMap<string, string>;
    }>(),
    {
        errorText: undefined,
        busyIds: () => new Set(),
        suggestIds: () => new Set(),
        warnings: () => new Map(),
    },
);

// At most one open ScorePicker across the list (same discipline as the
// StatusMenu single-open in App): the rateId of the row that owns it.
const openScoreId = ref<string | null>(null);

const emit = defineEmits<{
    'update:filterType': [type: SearchType];
    'update:filterStatus': [status: UserRateStatus];
    'load-more': [];
    retry: [];
    increment: [row: RateRowData];
    'set-score': [row: RateRowData, value: number];
    'mark-completed': [row: RateRowData];
    'dismiss-suggest': [row: RateRowData];
}>();

// US-3 status order, reused for the filter (default lives in use-lists).
const STATUSES: readonly UserRateStatus[] = [
    'planned',
    'watching',
    'rewatching',
    'completed',
    'on_hold',
    'dropped',
];

function onTypeChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as SearchType;
    if (value !== props.filterType) {
        emit('update:filterType', value);
    }
}

function onStatusChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as UserRateStatus;
    if (value !== props.filterStatus) {
        emit('update:filterStatus', value);
    }
}
</script>

<style scoped lang="scss">
.lists {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
}

.lists__filters {
    display: flex;
    flex-shrink: 0;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--color-border);
}

.lists__select {
    padding: 6px 8px;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: var(--color-bg);
    color: var(--color-fg);
    font: inherit;
    font-size: 13px;
    cursor: pointer;

    &:focus-visible {
        outline: none;
        border-color: var(--color-accent);
    }
}

.lists__results {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: thin;
}

.lists__more {
    display: flex;
    justify-content: center;
    padding: 12px;
}

.lists__more-btn {
    padding: 6px 20px;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: var(--color-surface);
    color: var(--color-fg);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;

    &:hover:not(:disabled) {
        border-color: var(--color-accent);
    }

    &:disabled {
        opacity: 0.6;
        cursor: default;
    }

    &:focus-visible {
        outline: 2px solid var(--color-accent);
        outline-offset: 2px;
    }
}
</style>
