<template>
    <section class="lists">
        <div class="lists__filters">
            <ChipGroup
                :options="TYPE_OPTIONS"
                :model-value="filterType"
                :aria-label="i18n.lists.typeFilterLabel"
                @update:model-value="emit('update:filterType', $event)"
            />
            <ChipGroup
                :options="statusOptions"
                :model-value="filterStatus"
                status-dots
                :aria-label="i18n.lists.statusFilterLabel"
                @update:model-value="emit('update:filterStatus', $event)"
            />
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
                    :score-open="isPopoverOpen('score', row.rateId)"
                    :status-open="isPopoverOpen('status', row.rateId)"
                    :warning="warnings.get(row.rateId) ?? null"
                    @increment="emit('increment', row)"
                    @set-progress="emit('set-progress', row, $event)"
                    @set-score="emit('set-score', row, $event)"
                    @change-status="emit('change-status', row, $event)"
                    @remove="emit('remove', row)"
                    @mark-completed="emit('mark-completed', row)"
                    @dismiss-suggest="emit('dismiss-suggest', row)"
                    @update:score-open="setPopover('score', row.rateId, $event)"
                    @update:status-open="setPopover('status', row.rateId, $event)"
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
import { computed, ref } from 'vue';
import ChipGroup from '@/src/components/ChipGroup.vue';
import type { ChipOption } from '@/src/components/ChipGroup.vue';
import EmptyState from '@/src/components/EmptyState.vue';
import ErrorState from '@/src/components/ErrorState.vue';
import RateRow from '@/src/components/RateRow.vue';
import SkeletonList from '@/src/components/SkeletonList.vue';
import type { RateRow as RateRowData, SearchType, UserRateStatus } from '@/src/lib/api/types';
import { i18n, statusLabel } from '@/src/lib/i18n';
import type { MediaKind } from '@/src/lib/i18n';

// "Мои списки" tab frame (US-4/5/6 + Ф3-7 status badge, docs/05): two chip
// rows (type + status), the row list with its data states, and "Ещё" pagination.
// Presentational only — data and mutations come from use-lists (Ф3-4) through
// props/emits. The only local state is which row's popover (score picker or
// status menu) is open (transient view state, at most one across the list).
//
// Props (fed by use-lists):
//   items         — rows for the current filter
//   listStatus    — which data state to render (skeleton|data|empty|error)
//   errorText     — message for the error state (falls back to a generic one)
//   hasMore       — another page exists → show "Ещё"
//   loadingMore   — the next page is loading → "Ещё" is disabled/labelled
//   filterType    — selected type (Аниме/Манга/Ранобэ, phase 4)
//   filterStatus  — selected status; use-lists starts it from the
//                   defaultListStatus setting, default 'watching' (docs/05)
//   busyIds       — rateIds with a write in flight (locks that row)
//   suggestIds    — rateIds showing the "перевести в «Просмотрено»?" offer
//   warnings      — rateId -> inline warning text (revoked edit access)
//
// Emits:
//   update:filterType(type) / update:filterStatus(status) — filter changed
//   load-more / retry                                      — pagination / error retry
//   increment(row) / set-progress(row, value) /
//   set-score(row, value) / change-status(row, value) /
//   remove(row) / mark-completed(row) /
//   dismiss-suggest(row)                                   — row actions, tagged
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

// At most one open popover across the whole list — either a ScorePicker or a
// StatusMenu, never both (opening one closes the other): which kind is open
// and the rateId of the row that owns it.
type PopoverKind = 'score' | 'status';
const openPopover = ref<{ kind: PopoverKind; rateId: string } | null>(null);

function isPopoverOpen(kind: PopoverKind, rateId: string): boolean {
    return openPopover.value?.kind === kind && openPopover.value.rateId === rateId;
}

function setPopover(kind: PopoverKind, rateId: string, open: boolean): void {
    if (open) {
        openPopover.value = { kind, rateId };
    } else if (isPopoverOpen(kind, rateId)) {
        // Close only if it is still ours: a stale close must not dismiss a
        // popover that has just been opened elsewhere.
        openPopover.value = null;
    }
}

const emit = defineEmits<{
    'update:filterType': [type: SearchType];
    'update:filterStatus': [status: UserRateStatus];
    'load-more': [];
    retry: [];
    increment: [row: RateRowData];
    'set-progress': [row: RateRowData, value: number];
    'set-score': [row: RateRowData, value: number];
    'change-status': [row: RateRowData, value: UserRateStatus];
    remove: [row: RateRowData];
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

const TYPE_OPTIONS: readonly ChipOption<SearchType>[] = [
    { value: 'anime', label: i18n.lists.types.anime },
    { value: 'manga', label: i18n.lists.types.manga },
    { value: 'ranobe', label: i18n.lists.types.ranobe },
];

// Status filter labels follow the selected type (phase 4): anime «Смотрю…»,
// manga/ranobe «Читаю…» (both are books wording-wise).
const filterMedia = computed<MediaKind>(() => (props.filterType === 'anime' ? 'anime' : 'book'));

const statusOptions = computed<readonly ChipOption<UserRateStatus>[]>(() =>
    STATUSES.map((s) => ({
        value: s,
        label: statusLabel(s, filterMedia.value),
    })),
);
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
    flex-direction: column;
    flex-shrink: 0;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--color-border);
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

    &:hover:not(:disabled) {
        border-color: var(--color-accent);
    }
}
</style>
