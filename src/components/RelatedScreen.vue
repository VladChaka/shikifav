<template>
    <section class="related">
        <!-- Not breadcrumbs — an exit. The second line is mandatory: the row the
             user arrived from is covered by this very screen, and without the
             name the list is a set of unrelated titles. It is drawn in every
             state, the skeleton included: the name is known from the row that
             was clicked, and the way out must work while the request runs. -->
        <div class="related__bar">
            <button
                ref="backEl"
                class="related__back"
                type="button"
                :aria-label="i18n.related.back"
                :title="i18n.related.back"
                @click="emit('close')"
            >
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                >
                    <line
                        x1="19"
                        y1="12"
                        x2="5"
                        y2="12"
                    />
                    <polyline points="12 19 5 12 12 5" />
                </svg>
            </button>
            <span class="related__bar-text">
                <h2 class="related__title">{{ i18n.related.title }}</h2>
                <span
                    class="related__target"
                    :title="targetTitle"
                    >{{ targetTitle }}</span
                >
            </span>
        </div>

        <div class="related__list">
            <SkeletonList v-if="screenStatus === 'skeleton'" />
            <EmptyState
                v-else-if="screenStatus === 'empty'"
                :text="i18n.related.empty"
                icon="🔗"
            />
            <ErrorState
                v-else-if="screenStatus === 'error'"
                :text="errorText ?? i18n.errors.internal"
                @retry="emit('retry')"
            />
            <template v-else>
                <!-- One section per relation kind; the heading is sticky inside
                     its own group, exactly like the day header of the calendar.
                     The counter shows the WHOLE group, so a long one says how
                     much is coming before it is scrolled — and before the
                     portion has drawn all of it. -->
                <section
                    v-for="group in groups"
                    :key="group.kind"
                >
                    <h3 class="list-heading">
                        {{ relationGroupLabel(group.kind, group.all) }}
                        <span class="related__count">{{ group.all.length }}</span>
                    </h3>
                    <RelatedRow
                        v-for="item in group.items"
                        :key="rateKey(item.card)"
                        :item="item"
                        :busy="busyIds.has(rateKey(item.card))"
                        :warning="warnings.get(rateKey(item.card)) ?? null"
                        :menu-open="openMenuKey === rateKey(item.card)"
                        @update:menu-open="
                            openMenuKey = $event ? rateKey(item.card) : null
                        "
                        @add="emit('add', item.card)"
                        @set-status="emit('set-status', item.card, $event)"
                        @remove="emit('remove', item.card)"
                    />
                </section>

                <!-- Portioned rendering: the data came in ONE answer, so the
                     button is instant and has no «загружаю ещё» state, unlike
                     «Ещё» in «Мои списки». The counter explains why the list
                     stopped — without it «Показать ещё» reads as a guess. -->
                <div
                    v-if="hasMore"
                    class="related__more"
                >
                    <span class="related__shown">{{ shownOfMessage(shown, total) }}</span>
                    <button
                        class="list-more-btn"
                        type="button"
                        @click="emit('load-more')"
                    >
                        {{ i18n.related.loadMore }}
                    </button>
                </div>
            </template>
        </div>
    </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import EmptyState from '@/src/components/EmptyState.vue';
import ErrorState from '@/src/components/ErrorState.vue';
import RelatedRow from '@/src/components/RelatedRow.vue';
import SkeletonList from '@/src/components/SkeletonList.vue';
import { rateKey } from '@/src/composables/use-rates';
import { useSettings } from '@/src/composables/use-settings';
import type { RelatedPortion, RelatedStatus, RelatedTarget } from '@/src/composables/use-related';
import type { TitleCard, UserRateStatus } from '@/src/lib/api/types';
import { i18n, relationGroupLabel, shownOfMessage } from '@/src/lib/i18n';
import { displayTitle } from '@/src/lib/title-name';

// «Связанные» — an overlay INSIDE the popup, over the tab row and the tab
// content but not over the header (US-11, design card screens/related): ⚙ and
// «Выйти» must stay reachable from every screen. The tab underneath keeps its
// state and its scroll position, so it is covered, never unmounted.
//
// Presentational, like MyListsTab and CalendarTab: rows, states and the portion
// counter come from use-related through props, every write leaves as an emit.
// The one thing owned here is which row has its menu open — transient view
// state, at most one across the screen.
//
// Two things this component must not do, both from the phase decisions:
//   - no [+1] and no score on a row (docs/06, decision 3);
//   - no «Связанные тайтлы» in the menus of its own rows (decision 4) — it
//     would lead from one title's links to another's, and the return bar knows
//     exactly one step back.
//
// Props (fed by use-related):
//   target       — whose links these are; the return bar prints its name
//   screenStatus — which data state to render (skeleton|data|empty|error)
//   errorText    — message for the error state (falls back to a generic one)
//   groups       — groups already cut to the current portion
//   shown/total  — «Показано {n} из {total}»
//   hasMore      — another portion is left → show the button
//   busyIds      — rateKeys with a write in flight (locks that row)
//   warnings     — rateKey -> inline warning text (revoked edit access)
//
// Emits: close / retry / load-more, and add(card) / set-status(card, status) /
// remove(card) — the writes, tagged with the card they belong to.
const props = withDefaults(
    defineProps<{
        target: RelatedTarget;
        screenStatus: RelatedStatus;
        errorText?: string;
        groups: RelatedPortion[];
        shown: number;
        total: number;
        hasMore: boolean;
        busyIds?: ReadonlySet<string>;
        warnings?: ReadonlyMap<string, string>;
    }>(),
    {
        errorText: undefined,
        busyIds: () => new Set(),
        warnings: () => new Map(),
    },
);

const emit = defineEmits<{
    close: [];
    retry: [];
    'load-more': [];
    add: [card: TitleCard];
    'set-status': [card: TitleCard, status: UserRateStatus];
    remove: [card: TitleCard];
}>();

// Ф4-6b invariant, as in SearchResults: the composite `${targetType}:${id}` key
// of busyIds/warnings is computed in the list owner and nowhere else — anime
// and manga ids are independent sequences, and a bare-id key would lock the
// wrong title.
const openMenuKey = ref<string | null>(null);

const backEl = ref<HTMLElement | null>(null);

// The return bar applies the «ромадзи»/«русские» setting at render time, like
// every other title in this UI — which is why the target carries the name pair
// and not a ready string.
const { settings } = useSettings();
const targetTitle = computed(() => displayTitle(props.target, settings.value.titleLang).primary);

// First stop of Tab on the screen, and the caret has to be somewhere: the
// control it came from is behind an inert overlay now.
onMounted(() => {
    backEl.value?.focus();
    document.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
    document.removeEventListener('keydown', onKeydown);
});

// Escape is claimed by two handlers at once — the open StatusMenu also listens
// on the document — and the menu must win: closing the whole screen because a
// menu was dismissed would throw away a step the user did not ask to undo.
// Order of the listeners is not part of the contract, so this one asks the
// state instead: while a menu is open the screen simply does not react, and
// the menu closes itself in the same event.
function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || openMenuKey.value !== null) {
        return;
    }
    emit('close');
}

// A row that leaves the portion (or the whole list, on a switch to another
// title) must not leave a menu hanging over rows it no longer belongs to.
//
// Watched by CONTENT, not by array identity. `groups` is a computed that
// rebuilds on every change of the underlying cards, and the poster backfill
// replaces the whole array while the very same rows stay on screen — watching
// identity closed a menu the user had just opened, for no visible reason.
// Keeping the key alive is enough: the menu dies exactly when its own row does.
const visibleRowKeys = computed(
    () => new Set(props.groups.flatMap((group) => group.items.map((item) => rateKey(item.card)))),
);

watch(visibleRowKeys, (keys) => {
    if (openMenuKey.value !== null && !keys.has(openMenuKey.value)) {
        openMenuKey.value = null;
    }
});
</script>

<style scoped lang="scss">
.related {
    /* Fills the box that holds the tab row and the tab content, so the popup
       header stays visible and usable above it. No transform is allowed on this
       element or any ancestor: it would become the containing block of the
       fixed StatusMenu and take the menu with it (use-popover-position) —
       which is why the appearance is a fade and nothing else. */
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--color-bg);
    animation: related-fade 120ms ease-out;
}

@keyframes related-fade {
    from {
        opacity: 0;
    }
}

@media (prefers-reduced-motion: reduce) {
    .related {
        animation: none;
    }
}

.related__bar {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 8px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--color-border);
}

.related__back {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--color-fg-muted);

    svg {
        width: 16px;
        height: 16px;
    }

    &:hover {
        background: var(--color-surface);
        color: var(--color-fg);
    }

    /* Tighter ring: the arrow sits 8px from the title beside it. */
    &:focus-visible {
        outline-offset: 1px;
    }
}

.related__bar-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
}

.related__title {
    margin: 0;
    font-size: 12.5px;
    font-weight: 600;
    line-height: 1.3;
}

.related__target {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 11.5px;
    color: var(--color-fg-muted);
    line-height: 1.3;
}

.related__list {
    /* The scroll container the sticky group headings stick to. */
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: thin;
}

/* Plain number, no plural forms: it says whether the group is worth scrolling. */
.related__count {
    margin-left: auto;
    font-weight: 400;
    font-variant-numeric: tabular-nums;
}

.related__more {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 12px;
}

.related__shown {
    font-size: 11.5px;
    color: var(--color-fg-muted);
    font-variant-numeric: tabular-nums;
}
</style>
