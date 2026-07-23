<template>
    <article class="rate">
        <img
            v-if="rate.posterUrl"
            class="rate__poster"
            :src="rate.posterUrl"
            :srcset="posterSrcset"
            width="60"
            height="94"
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
                        :class="{ 'rate__score-btn--set': rate.score > 0 }"
                        type="button"
                        :disabled="busy"
                        :aria-label="i18n.score.label"
                        :title="i18n.score.label"
                        @click.stop="toggleScore"
                    >
                        <span aria-hidden="true">{{ rate.score > 0 ? `★ ${rate.score}` : '☆' }}</span>
                    </button>
                    <ScorePicker
                        v-if="scoreOpen"
                        :current="rate.score"
                        @select="onScore"
                        @close="emit('update:scoreOpen', false)"
                    />
                </div>
            </div>

            <div class="rate__progress-row">
                <span class="rate__progress">{{ progressText }}</span>
                <button
                    v-if="showIncrement"
                    class="rate__inc"
                    type="button"
                    :disabled="busy"
                    :aria-label="i18n.rates.increment"
                    :title="i18n.rates.increment"
                    @click="emit('increment')"
                >
                    +1
                </button>
            </div>

            <!-- Progress reached the total: offer to complete (US-6, never auto).
                 Shown purely from the suggestCompleted flag; the decision is the
                 parent's. -->
            <div
                v-if="suggestCompleted"
                class="rate__suggest"
                role="status"
            >
                <span class="rate__suggest-text">{{ i18n.rates.markCompletedQuestion }}</span>
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
import type { RateRow } from '@/src/lib/api/types';
import { i18n } from '@/src/lib/i18n';

// "Мои списки" list row (US-4/5/6). Presentational only: progress, +1, score
// and the "completed?" suggestion are emitted upwards; `busy` locks actions
// while a write is in flight and `suggestCompleted` toggles the inline offer.
// `scoreOpen` is parent-owned (single open picker across the list, same
// discipline as TitleCard's menuOpen).
//
// Emits:
//   increment                — user pressed [+1]
//   set-score(value)         — a score 0..10 was chosen (0 = remove)
//   mark-completed           — accepted the "перевести в «Просмотрено»?" offer
//   dismiss-suggest          — postponed that offer
//   update:scoreOpen(open)   — toggle/close the score picker
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
        // Inline non-blocking warning under the row (e.g. edit access revoked).
        warning?: string | null;
    }>(),
    { scoreOpen: false, warning: null },
);

const emit = defineEmits<{
    increment: [];
    'set-score': [value: number];
    'mark-completed': [];
    'dismiss-suggest': [];
    'update:scoreOpen': [open: boolean];
}>();

const title = computed(() => props.rate.russian || props.rate.name);

const posterSrcset = computed(() =>
    props.rate.posterUrl && props.rate.posterUrl2x
        ? `${props.rate.posterUrl} 1x, ${props.rate.posterUrl2x} 2x`
        : undefined,
);

// "7 / 12 эп." when the total is known; "7 эп." when total == 0 (unknown/ongoing).
const progressText = computed(() => {
    const { progress, total } = props.rate;
    const unit = i18n.card.episodesShort;
    return total > 0 ? `${progress} / ${total} ${unit}` : `${progress} ${unit}`;
});

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
</script>

<style scoped lang="scss">
.rate {
    display: flex;
    gap: 10px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--color-border);
}

.rate__poster {
    /* Fixed 60x94 box (poster.miniUrl size): no layout shift while loading. */
    flex-shrink: 0;
    width: 60px;
    height: 94px;
    border-radius: 4px;
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

.rate__score-btn {
    padding: 2px 6px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--color-fg-muted);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.3;
    cursor: pointer;

    &:hover:not(:disabled) {
        background: var(--color-surface);
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

.rate__score-btn--set {
    color: var(--color-accent);
}

.rate__progress-row {
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

.rate__inc {
    padding: 3px 10px;
    border: none;
    border-radius: 6px;
    background: var(--color-accent);
    color: var(--color-accent-fg);
    font: inherit;
    font-size: 12.5px;
    font-weight: 600;
    line-height: 1.3;
    cursor: pointer;

    &:hover:not(:disabled) {
        background: var(--color-accent-hover);
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

.rate__suggest {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 6px;
}

.rate__suggest-text {
    font-size: 12px;
    color: var(--color-fg-muted);
}

.rate__suggest-btn {
    padding: 3px 10px;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: var(--color-surface);
    color: var(--color-fg);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    line-height: 1.3;
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

.rate__suggest-btn--yes {
    border-color: transparent;
    background: var(--color-accent);
    color: var(--color-accent-fg);

    &:hover:not(:disabled) {
        border-color: transparent;
        background: var(--color-accent-hover);
    }
}

.rate__warning {
    margin: 6px 0 0;
    font-size: 12px;
    color: var(--color-danger);
}
</style>
