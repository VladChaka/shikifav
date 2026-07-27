<template>
    <article class="rate">
        <img
            v-if="rate.posterUrl"
            class="rate__poster"
            :src="rate.posterUrl"
            :srcset="posterSrcset"
            width="42"
            height="58"
            loading="lazy"
            alt=""
        />
        <span
            v-else
            class="rate__poster rate__poster--empty"
            aria-hidden="true"
        >
            <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
            >
                <rect
                    x="3"
                    y="3"
                    width="18"
                    height="18"
                    rx="2"
                />
                <circle
                    cx="9"
                    cy="9"
                    r="2"
                />
                <path d="m21 15-4-4-9 9" />
            </svg>
        </span>

        <div class="rate__body">
            <div class="rate__title-row">
                <h3
                    class="rate__title"
                    :title="title"
                >
                    {{ title }}
                </h3>
                <!-- Anchor for the absolutely positioned ScorePicker. -->
                <div class="rate__score">
                    <button
                        class="rate__score-btn"
                        :class="{ 'rate__score-btn--empty': rate.score === 0 }"
                        type="button"
                        :disabled="busy"
                        :aria-label="i18n.score.label"
                        :title="i18n.score.label"
                        @click.stop="toggleScore"
                    >
                        <span aria-hidden="true">{{ rate.score > 0 ? rate.score : '—' }}</span>
                    </button>
                    <ScorePicker
                        v-if="scoreOpen"
                        :current="rate.score"
                        @select="onScore"
                        @close="emit('update:scoreOpen', false)"
                    />
                </div>
            </div>

            <!-- The row itself is the anchor for the absolutely positioned
                 StatusMenu: left-aligned under it the menu always fits the
                 popup width (a badge-aligned menu would overflow the right
                 edge). -->
            <div class="rate__progress-row">
                <span class="rate__progress">{{ progressText }}</span>
                <button
                    v-if="showIncrement"
                    class="rate__inc"
                    type="button"
                    :disabled="busy"
                    :aria-label="incrementLabel"
                    :title="incrementLabel"
                    @click="emit('increment')"
                >
                    +1
                </button>
                <!-- Current status badge pill (global .badge/.st-*, compact
                     sizes), click opens the StatusMenu — same as TitleCard. -->
                <button
                    class="rate__badge badge"
                    :class="`st-${rate.status}`"
                    type="button"
                    :disabled="busy"
                    :title="i18n.actions.chooseStatus"
                    @click.stop="toggleStatus"
                >
                    <span
                        class="dot"
                        aria-hidden="true"
                    ></span>
                    {{ statusLabel(rate.status, media) }}
                    <span
                        class="car"
                        aria-hidden="true"
                        >▾</span
                    >
                </button>
                <StatusMenu
                    v-if="statusOpen"
                    :current="rate.status"
                    :media="media"
                    @select="onStatus"
                    @remove="onRemove"
                    @close="emit('update:statusOpen', false)"
                />
            </div>

            <!-- Progress reached the total: offer to complete (US-6, never auto).
                 Shown purely from the suggestCompleted flag; the decision is the
                 parent's. -->
            <div
                v-if="suggestCompleted"
                class="rate__suggest"
                role="status"
            >
                <span class="rate__suggest-text">{{ suggestQuestion }}</span>
                <button
                    class="rate__suggest-btn rate__suggest-btn--yes"
                    type="button"
                    :disabled="busy"
                    @click="emit('mark-completed')"
                >
                    {{ i18n.common.yes }}
                </button>
                <button
                    class="rate__suggest-btn"
                    type="button"
                    :disabled="busy"
                    @click="emit('dismiss-suggest')"
                >
                    {{ i18n.common.later }}
                </button>
            </div>

            <!-- Lazy revoked-access warning, non-blocking (docs/05, phase 2);
                 same pattern as TitleCard. -->
            <p
                v-if="warning"
                class="rate__warning"
                role="alert"
            >
                {{ warning }}
            </p>
        </div>
    </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import ScorePicker from '@/src/components/ScorePicker.vue';
import StatusMenu from '@/src/components/StatusMenu.vue';
import { useSettings } from '@/src/composables/use-settings';
import type { RateRow, UserRateStatus } from '@/src/lib/api/types';
import { i18n, mediaOf, statusLabel } from '@/src/lib/i18n';
import { displayTitle } from '@/src/lib/title-name';

// "Мои списки" list row (US-4/5/6 + Ф3-7 status badge). Presentational only:
// progress, +1, score, status change/removal and the "completed?" suggestion
// are emitted upwards; `busy` locks all actions while a write is in flight and
// `suggestCompleted` toggles the inline offer. `scoreOpen`/`statusOpen` are
// parent-owned (at most one popover open across the list, same discipline as
// TitleCard's menuOpen).
//
// Emits:
//   increment                — user pressed [+1]
//   set-score(value)         — a score 0..10 was chosen (0 = remove)
//   change-status(value)     — a different status was picked in the StatusMenu
//                              (picking the current one only closes the menu)
//   remove                   — «Удалить из списка» picked in the StatusMenu
//   mark-completed           — accepted the "перевести в «Просмотрено»?" offer
//   dismiss-suggest          — postponed that offer
//   update:scoreOpen(open)   — toggle/close the score picker
//   update:statusOpen(open)  — toggle/close the status menu
const props = withDefaults(
    defineProps<{
        rate: RateRow;
        // A write for this row is in flight: actions are locked.
        busy: boolean;
        // Show the inline "перевести в «Просмотрено»?" offer (parent-driven).
        suggestCompleted: boolean;
        // Whether this row's score picker is open (single-open coordination
        // lives in the list owner via update:scoreOpen).
        scoreOpen?: boolean;
        // Whether this row's status menu is open (same coordination via
        // update:statusOpen; the owner keeps score/status mutually exclusive).
        statusOpen?: boolean;
        // Inline non-blocking warning under the row (e.g. edit access revoked).
        warning?: string | null;
    }>(),
    { scoreOpen: false, statusOpen: false, warning: null },
);

const emit = defineEmits<{
    increment: [];
    'set-score': [value: number];
    'change-status': [value: UserRateStatus];
    remove: [];
    'mark-completed': [];
    'dismiss-suggest': [];
    'update:scoreOpen': [open: boolean];
    'update:statusOpen': [open: boolean];
}>();

// Which name goes first is a setting (docs/05 «Названия»). A list row shows one
// name only, so the second one from displayTitle is deliberately dropped.
const { settings } = useSettings();
const title = computed(() => displayTitle(props.rate, settings.value.titleLang).primary);

// Wording follows the row media (phase 4): anime counts episodes
// («эп.», «+1 эпизод», «Просмотрено»), manga/ranobe count chapters
// («гл.», «+1 глава», «Прочитано»).
const media = computed(() => mediaOf(props.rate.targetType));

const posterSrcset = computed(() =>
    props.rate.posterUrl && props.rate.posterUrl2x
        ? `${props.rate.posterUrl} 1x, ${props.rate.posterUrl2x} 2x`
        : undefined,
);

// "7 / 12 эп." (or "гл.") when the total is known; "7 эп." when total == 0
// (unknown/ongoing).
const progressText = computed(() => {
    const { progress, total } = props.rate;
    const unit = media.value === 'book' ? i18n.card.chaptersShort : i18n.card.episodesShort;
    return total > 0 ? `${progress} / ${total} ${unit}` : `${progress} ${unit}`;
});

// aria/title of the [+1] button: «+1 эпизод» / «+1 глава».
const incrementLabel = computed(() =>
    media.value === 'book' ? i18n.rates.incrementChapter : i18n.rates.increment,
);

// US-6 inline offer wording: «Просмотрено?» / «Прочитано?».
const suggestQuestion = computed(() =>
    media.value === 'book' ? i18n.rates.markReadQuestion : i18n.rates.markCompletedQuestion,
);

// [+1] only while actively watching and below the known maximum (docs/05, US-6).
// total == 0 means the maximum is unknown, so incrementing is always allowed.
const showIncrement = computed(() => {
    const { status, progress, total } = props.rate;
    const active = status === 'watching' || status === 'rewatching';
    return active && (total === 0 || progress < total);
});

function toggleScore(): void {
    emit('update:scoreOpen', !props.scoreOpen);
}

function onScore(value: number): void {
    emit('update:scoreOpen', false);
    emit('set-score', value);
}

function toggleStatus(): void {
    emit('update:statusOpen', !props.statusOpen);
}

function onStatus(value: UserRateStatus): void {
    emit('update:statusOpen', false);
    // Re-picking the current status is a no-op: no pointless write / rate spend.
    if (value !== props.rate.status) {
        emit('change-status', value);
    }
}

function onRemove(): void {
    emit('update:statusOpen', false);
    emit('remove');
}
</script>

<style scoped lang="scss">
.rate {
    display: flex;
    gap: 12px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--color-border);
}

.rate__poster {
    /* Fixed 42x58 box (components-rate-row): no layout shift while loading. */
    flex-shrink: 0;
    width: 42px;
    height: 58px;
    border-radius: 5px;
    background: var(--color-surface);
    object-fit: cover;
}

.rate__poster--empty {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-fg-muted);
}

.rate__body {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
}

.rate__title-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
}

.rate__title {
    /* Up to two lines, then ellipsis. */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    flex: 1;
    margin: 0;
    font-size: 13.5px;
    font-weight: 600;
    line-height: 1.3;
}

.rate__score {
    /* Anchor for the absolutely positioned ScorePicker. */
    position: relative;
    flex-shrink: 0;
}

/* My score button per the components-rate-row card (.scorebtn). */
.rate__score-btn {
    padding: 2px 8px;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: transparent;
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
        outline-offset: 1px;
    }
}

.rate__score-btn--empty {
    color: var(--color-fg-muted);
}

.rate__progress-row {
    /* Anchor for the absolutely positioned StatusMenu (left-aligned under
       the row so the 180px menu never overflows the popup right edge). */
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: auto;
    padding-top: 6px;
}

.rate__progress {
    font-size: 12px;
    color: var(--color-fg-muted);
}

/* "+1" per the components-rate-row card (.plus). */
.rate__inc {
    padding: 2px 9px;
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

/* Compact pill sizes on top of the global .badge (components-rate-row card). */
.rate__badge {
    flex-shrink: 0;
    gap: 5px;
    margin-left: auto;
    padding: 2px 8px 2px 7px;
    font-size: 11px;
    white-space: nowrap;
    cursor: pointer;

    &:hover:not(:disabled) {
        border-color: var(--sc);
    }

    &:disabled {
        opacity: 0.6;
        cursor: default;
    }

    &:focus-visible {
        outline: 2px solid var(--color-accent);
        outline-offset: 1px;
    }

    .dot {
        width: 6px;
        height: 6px;
    }

    .car {
        font-size: 9px;
    }
}

/* Inline "перевести в «Просмотрено»?" per the components-rate-row card
   (.askdone): muted question + accent/muted link buttons. */
.rate__suggest {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
    font-size: 13px;
}

.rate__suggest-text {
    color: var(--color-fg-muted);
}

.rate__suggest-btn {
    padding: 2px 4px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--color-fg-muted);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;

    &:hover:not(:disabled) {
        text-decoration: underline;
    }

    &:disabled {
        opacity: 0.6;
        cursor: default;
    }

    &:focus-visible {
        outline: 2px solid var(--color-accent);
        outline-offset: 1px;
    }
}

.rate__suggest-btn--yes {
    color: var(--color-accent);
}

/* Inline warning per the screens-states card (.warn). */
.rate__warning {
    margin: 8px 0 0;
    padding: 9px 11px;
    border: 1px solid color-mix(in srgb, var(--color-danger) 35%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, var(--color-danger) 12%, transparent);
    color: var(--color-danger);
    font-size: 12.5px;
}
</style>
