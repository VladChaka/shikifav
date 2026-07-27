<template>
    <article class="card">
        <img
            v-if="card.posterUrl"
            class="card__poster"
            :src="card.posterUrl"
            :srcset="posterSrcset"
            width="48"
            height="66"
            loading="lazy"
            alt=""
        />
        <span
            v-else
            class="card__poster card__poster--empty"
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

        <div class="card__body">
            <div class="card__title-row">
                <h3
                    class="card__title"
                    :title="title"
                >
                    {{ title }}
                </h3>
                <span
                    v-if="scoreText"
                    class="card__score"
                    >{{ scoreText }}</span
                >
            </div>
            <p
                v-if="original"
                class="card__original"
                :title="original"
            >
                {{ original }}
            </p>
            <p
                v-if="meta"
                class="card__meta"
            >
                {{ meta }}
            </p>

            <div class="card__control">
                <!-- Not in my list: split button — primary part adds to "planned"
                     in one click, the caret opens the full status menu (docs/05). -->
                <span
                    v-if="card.userRate === null"
                    class="card__split"
                >
                    <button
                        class="card__add"
                        type="button"
                        :disabled="busy"
                        @click="emit('add')"
                    >
                        {{ i18n.actions.addPlanned }}
                    </button>
                    <button
                        class="card__caret"
                        type="button"
                        :disabled="busy"
                        :aria-label="i18n.actions.chooseStatus"
                        :title="i18n.actions.chooseStatus"
                        @click.stop="toggleMenu"
                    >
                        <span aria-hidden="true">▾</span>
                    </button>
                </span>
                <!-- In my list: colored status badge pill (global .badge/.st-*),
                     click opens the menu. -->
                <button
                    v-else
                    class="card__badge badge"
                    :class="`st-${card.userRate.status}`"
                    type="button"
                    :disabled="busy"
                    :title="i18n.actions.chooseStatus"
                    @click.stop="toggleMenu"
                >
                    <span
                        class="dot"
                        aria-hidden="true"
                    ></span>
                    {{ statusLabel(card.userRate.status, media) }}
                    <span
                        class="car"
                        aria-hidden="true"
                        >▾</span
                    >
                </button>

                <StatusMenu
                    v-if="menuOpen"
                    :current="card.userRate?.status ?? null"
                    :media="media"
                    @select="onSelect"
                    @remove="onRemove"
                    @close="emit('update:menuOpen', false)"
                />
            </div>

            <!-- Lazy revoked-access warning, non-blocking (docs/05, phase 2). -->
            <p
                v-if="warning"
                class="card__warning"
                role="alert"
            >
                {{ warning }}
            </p>
        </div>
    </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import StatusMenu from '@/src/components/StatusMenu.vue';
import type { TitleCard, UserRateStatus } from '@/src/lib/api/types';
import { i18n, kindLabel, mediaOf, statusLabel, titleStatusLabel } from '@/src/lib/i18n';

// Search result card (US-2/US-3). Presentational only: mutations are emitted
// upwards, `busy`, `warning` and `menuOpen` are controlled by the owner of the
// data — the list keeps at most one status menu open across all cards.
const props = withDefaults(
    defineProps<{
        card: TitleCard;
        // A write for this title is in flight: actions are locked.
        busy?: boolean;
        // Inline non-blocking warning under the card (e.g. edit access revoked).
        warning?: string | null;
        // Whether this card's status menu is open (single-open coordination
        // lives in the list owner via update:menuOpen).
        menuOpen?: boolean;
    }>(),
    { busy: false, warning: null, menuOpen: false },
);

const emit = defineEmits<{
    // Primary one-click "add to planned".
    add: [];
    // Status picked in the menu; for a card without userRate this means
    // "create with that status", for a card with userRate — "update".
    'set-status': [status: UserRateStatus];
    remove: [];
    'update:menuOpen': [open: boolean];
}>();

const title = computed(() => props.card.russian || props.card.name);
// Original name goes second and only when the first row is the Russian one.
const original = computed(() => (props.card.russian ? props.card.name : null));

// Wording/meta variant (phase 4): anime cards show episodes and «Смотрю…»
// labels, manga/ranobe cards show volumes/chapters and «Читаю…» labels.
const media = computed(() => mediaOf(props.card.targetType));

// 0.0 means "no score yet" (announcements) — hidden.
const scoreText = computed(() =>
    props.card.score && props.card.score > 0 ? props.card.score.toFixed(1) : null,
);

const posterSrcset = computed(() =>
    props.card.posterUrl && props.card.posterUrl2x
        ? `${props.card.posterUrl} 1x, ${props.card.posterUrl2x} 2x`
        : undefined,
);

const meta = computed(() => {
    const parts: string[] = [];
    const kind = kindLabel(props.card.kind);
    if (kind) {
        parts.push(kind);
    }
    if (props.card.year !== null) {
        parts.push(String(props.card.year));
    }
    const status = titleStatusLabel(props.card.status);
    if (status) {
        parts.push(status);
    }
    const amount = media.value === 'book' ? volumesChaptersText() : episodesText();
    if (amount) {
        parts.push(amount);
    }
    return parts.join(' · ');
});

// "5 / 24 эп." for ongoings, "28 эп." otherwise (anime cards).
function episodesText(): string | null {
    const { episodes, episodesAired, status } = props.card;
    if (status === 'ongoing' && episodesAired !== undefined) {
        const total = episodes && episodes > 0 ? String(episodes) : '?';
        return `${episodesAired} / ${total} ${i18n.card.episodesShort}`;
    }
    if (episodes && episodes > 0) {
        return `${episodes} ${i18n.card.episodesShort}`;
    }
    return null;
}

// "27 т. · 240 гл." for manga/ranobe cards; zero counters (ongoings,
// announcements) are simply omitted.
function volumesChaptersText(): string | null {
    const parts: string[] = [];
    if (props.card.volumes && props.card.volumes > 0) {
        parts.push(`${props.card.volumes} ${i18n.card.volumesShort}`);
    }
    if (props.card.chapters && props.card.chapters > 0) {
        parts.push(`${props.card.chapters} ${i18n.card.chaptersShort}`);
    }
    return parts.length > 0 ? parts.join(' · ') : null;
}

function toggleMenu(): void {
    emit('update:menuOpen', !props.menuOpen);
}

function onSelect(status: UserRateStatus): void {
    emit('update:menuOpen', false);
    emit('set-status', status);
}

function onRemove(): void {
    emit('update:menuOpen', false);
    emit('remove');
}
</script>

<style scoped lang="scss">
.card {
    display: flex;
    gap: 12px;
    padding: 11px 12px;
    border-bottom: 1px solid var(--color-border);
}

.card__poster {
    /* Fixed 48x66 box (components-title-card): no layout shift while loading. */
    flex-shrink: 0;
    width: 48px;
    height: 66px;
    border-radius: 5px;
    background: var(--color-surface);
    object-fit: cover;
}

.card__poster--empty {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-fg-muted);
}

.card__body {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
}

.card__title-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
}

.card__title {
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

.card__score {
    flex-shrink: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--color-accent);
}

.card__original,
.card__meta {
    margin: 2px 0 0;
    overflow: hidden;
    font-size: 12px;
    color: var(--color-fg-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.card__control {
    /* Anchor for the absolutely positioned StatusMenu. */
    position: relative;
    align-self: flex-start;
    margin-top: auto;
    padding-top: 6px;
}

/* Split button "+ Запланировано ▾" (components-title-card card). */
.card__split {
    display: inline-flex;
}

.card__add,
.card__caret {
    padding: 5px 11px;
    border: 1px solid var(--color-accent);
    background: var(--color-accent);
    color: var(--color-accent-fg);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;

    &:hover:not(:disabled) {
        background: var(--color-accent-hover);
        border-color: var(--color-accent-hover);
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

.card__add {
    border-radius: 6px 0 0 6px;
}

.card__caret {
    padding: 5px 8px;
    border-left: 1px solid rgb(255 255 255 / 35%);
    border-radius: 0 6px 6px 0;
}

/* Visual comes from the global .badge/.st-* classes; here only the button
   reset and the interactive states of the pill. */
.card__badge {
    padding: 4px 10px 4px 8px;
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
        outline-offset: 2px;
    }
}

/* Inline warning per the screens-states card (.warn). */
.card__warning {
    margin: 8px 0 0;
    padding: 9px 11px;
    border: 1px solid color-mix(in srgb, var(--color-danger) 35%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, var(--color-danger) 12%, transparent);
    color: var(--color-danger);
    font-size: 12.5px;
}
</style>
