<template>
    <section class="calendar">
        <div class="calendar__list">
            <SkeletonList v-if="screenStatus === 'skeleton'" />
            <EmptyState
                v-else-if="screenStatus === 'empty'"
                :text="i18n.calendar.empty"
                icon="📅"
            />
            <ErrorState
                v-else-if="screenStatus === 'error'"
                :text="errorText ?? i18n.errors.internal"
                @retry="emit('retry')"
            />
            <template v-else>
                <!-- One section per local day; the header is sticky inside its
                     own group, so scrolling swaps the bars one by one. -->
                <section
                    v-for="day in days"
                    :key="day.key"
                    class="calendar__day"
                >
                    <h3 class="calendar__day-title">{{ day.label }}</h3>
                    <CalendarRow
                        v-for="entry in day.entries"
                        :key="entry.item.targetId"
                        :entry="entry"
                    />
                </section>
            </template>
        </div>
    </section>
</template>

<script setup lang="ts">
import CalendarRow from '@/src/components/CalendarRow.vue';
import EmptyState from '@/src/components/EmptyState.vue';
import ErrorState from '@/src/components/ErrorState.vue';
import SkeletonList from '@/src/components/SkeletonList.vue';
import type { CalendarItem } from '@/src/lib/api/types';
import type { ScheduleDay } from '@/src/lib/calendar-schedule';
import { i18n } from '@/src/lib/i18n';

// «Календарь» tab frame (US-9, screens/calendar card): the day groups and the
// four data states. Presentational only — the rows, their grouping and the
// refresh come from use-calendar through props/emits (same split as
// MyListsTab), and the tab is read-only, so there is nothing else to emit.
//
// There is no type chip row on purpose: the calendar is anime-only (Manga has
// no nextEpisodeAt, docs/03), and a lone «Аниме» chip would promise a choice
// that does not exist.
//
// Props (fed by use-calendar):
//   days         — rows already grouped into local days, undated group last
//   screenStatus — which data state to render (skeleton|data|empty|error);
//                  named after the composable, because a calendar row carries
//                  its own `status` (my list status badge)
//   errorText    — message for the error state (falls back to a generic one)
//
// Emits: retry — «Повторить» in the error state.
withDefaults(
    defineProps<{
        days: ScheduleDay<CalendarItem>[];
        screenStatus: 'skeleton' | 'data' | 'empty' | 'error';
        errorText?: string;
    }>(),
    { errorText: undefined },
);

const emit = defineEmits<{
    retry: [];
}>();
</script>

<style scoped lang="scss">
.calendar {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
}

.calendar__list {
    /* The scroll container the sticky day headers stick to. */
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: thin;
}

.calendar__day-title {
    position: sticky;
    top: 0;
    z-index: 1;
    margin: 0;
    padding: 6px 12px;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-fg-muted);
    font-size: 11.5px;
    font-weight: 600;
    letter-spacing: 0.02em;
}
</style>
