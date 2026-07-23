<template>
    <article class="card">
        <img
            v-if="card.posterUrl"
            class="card__poster"
            :src="card.posterUrl"
            :srcset="posterSrcset"
            width="60"
            height="94"
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
                <!-- In my list: current status badge, click opens the menu. -->
                <button
                    v-else
                    class="card__badge"
                    type="button"
                    :disabled="busy"
                    :title="i18n.actions.chooseStatus"
                    @click.stop="toggleMenu"
                >
                    {{ statusLabel(card.userRate.status) }}
                    <span
                        class="card__badge-caret"
                        aria-hidden="true"
                        >▾</span
                    >
                </button>

                <StatusMenu
                    v-if="menuOpen"
                    :current="card.userRate?.status ?? null"
                    @select="onSelect"
                    @remove="onRemove"
                    @close="menuOpen = false"
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
import { computed, ref } from 'vue';
import StatusMenu from '@/src/components/StatusMenu.vue';
import type { TitleCard, UserRateStatus } from '@/src/lib/api/types';
import { i18n, kindLabel, statusLabel, titleStatusLabel } from '@/src/lib/i18n';

// Search result card (US-2/US-3). Presentational only: mutations are emitted
// upwards, `busy` and `warning` are controlled by the owner of the data.
const props = withDefaults(
    defineProps<{
        card: TitleCard;
        // A write for this title is in flight: actions are locked.
        busy?: boolean;
        // Inline non-blocking warning under the card (e.g. edit access revoked).
        warning?: string | null;
    }>(),
    { busy: false, warning: null },
);

const emit = defineEmits<{
    // Primary one-click "add to planned".
    add: [];
    // Status picked in the menu; for a card without userRate this means
    // "create with that status", for a card with userRate — "update".
    'set-status': [status: UserRateStatus];
    remove: [];
}>();

const title = computed(() => props.card.russian || props.card.name);
// Original name goes second and only when the first row is the Russian one.
const original = computed(() => (props.card.russian ? props.card.name : null));

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
    const episodes = episodesText();
    if (episodes) {
        parts.push(episodes);
    }
    return parts.join(' · ');
});

// "5 / 24 эп." for ongoings, "28 эп." otherwise; chapters/volumes — phase 4.
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

const menuOpen = ref(false);

function toggleMenu(): void {
    menuOpen.value = !menuOpen.value;
}

function onSelect(status: UserRateStatus): void {
    menuOpen.value = false;
    emit('set-status', status);
}

function onRemove(): void {
    menuOpen.value = false;
    emit('remove');
}
</script>

<style scoped lang="scss">
.card {
    display: flex;
    gap: 10px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--color-border);
}

.card__poster {
    /* Fixed 60x94 box (poster.miniUrl size): no layout shift while loading. */
    flex-shrink: 0;
    width: 60px;
    height: 94px;
    border-radius: 4px;
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

.card__split {
    display: inline-flex;
}

.card__add,
.card__caret {
    padding: 4px 10px;
    border: none;
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

.card__add {
    border-radius: 6px 0 0 6px;
}

.card__caret {
    padding: 4px 7px;
    border-left: 1px solid var(--color-accent-fg);
    border-radius: 0 6px 6px 0;
    opacity: 0.92;
}

.card__badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
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
        outline-offset: 2px;
    }
}

.card__badge-caret {
    color: var(--color-fg-muted);
}

.card__warning {
    margin: 6px 0 0;
    font-size: 12px;
    color: var(--color-danger);
}
</style>
