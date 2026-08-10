<template>
    <article class="related-row">
        <!-- Poster box: an <a> to the title page when there is one, a plain
             <div> of the same geometry otherwise — the same rule as in
             TitleCard and RateRow. -->
        <component
            :is="href ? 'a' : 'div'"
            class="related-row__poster-box"
            v-bind="posterLinkAttrs"
        >
            <img
                class="related-row__poster"
                :class="{ 'related-row__poster--placeholder': !card.posterUrl }"
                :src="posterSrc"
                :srcset="posterSrcset"
                width="42"
                height="58"
                loading="lazy"
                alt=""
            />
        </component>

        <div class="related-row__body">
            <div class="related-row__title-row">
                <h3
                    class="related-row__title"
                    :title="title"
                >
                    <a
                        v-if="href"
                        class="related-row__title-link"
                        :href="href"
                        target="_blank"
                        rel="noopener noreferrer"
                        >{{ title }}</a
                    >
                    <template v-else>{{ title }}</template>
                </h3>
                <span
                    v-if="scoreText"
                    class="related-row__score"
                    >{{ scoreText }}</span
                >
            </div>

            <!-- Meta: the server's own wording of the link first, then what the
                 title is. `relationText` is untrusted server text and is only
                 ever interpolated — never v-html. -->
            <p class="related-row__meta">{{ meta }}</p>

            <div class="related-row__control">
                <!-- Not in my list: the split button of the search card, one
                     size down. No [+1] and no score on this screen (docs/06,
                     decision 3) — those need a progress the answer does not
                     carry and live in «Мои списки». -->
                <span
                    v-if="card.userRate === null"
                    class="related-row__split"
                >
                    <button
                        class="related-row__add"
                        type="button"
                        :disabled="busy"
                        @click="emit('add')"
                    >
                        {{ addLabel }}
                    </button>
                    <button
                        class="related-row__caret"
                        type="button"
                        :disabled="busy"
                        :aria-label="i18n.actions.chooseStatus"
                        :title="i18n.actions.chooseStatus"
                        @click.stop="toggleMenu"
                    >
                        <span aria-hidden="true">▾</span>
                    </button>
                </span>
                <!-- In my list: the status badge pill, compact sizes. -->
                <button
                    v-else
                    class="related-row__badge badge"
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

                <!-- No `with-related` here: the item would lead from the links
                     of one title to the links of another, and the return bar
                     knows exactly one step back (docs/06, decision 4). -->
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
                class="related-row__warning"
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
import posterFallback from '@/src/assets/poster-fallback.png';
import { useSettings } from '@/src/composables/use-settings';
import type { RelatedItem, UserRateStatus } from '@/src/lib/api/types';
import { i18n, kindLabel, mediaOf, statusLabel } from '@/src/lib/i18n';
import { displayTitle } from '@/src/lib/title-name';
import { titleHref } from '@/src/lib/title-url';

// One row of the «Связанные» screen (US-11, design card screens/related).
// Denser than a search card by design — 80,34px against 128,69 — because the
// screen answers «что ещё есть у этой истории», and what matters is how many
// names are in the frame at once: poster 42×58 as in RateRow, the name in ONE
// line, and a single action.
//
// Presentational only, exactly like TitleCard: `busy`, `warning` and `menuOpen`
// are owned by the screen (at most one menu open across the list), and every
// mutation is emitted upwards.
//
// Props:
//   item      — the link plus the card behind it
//   busy      — a write for this title is in flight, the control is locked
//   warning   — inline non-blocking warning under the row
//   menuOpen  — whether THIS row owns the open status menu
//
// Emits: add / set-status(status) / remove / update:menuOpen(open) — the same
// four as TitleCard, so the screen wires them the same way the search does.
const props = withDefaults(
    defineProps<{
        item: RelatedItem;
        busy?: boolean;
        warning?: string | null;
        menuOpen?: boolean;
    }>(),
    { busy: false, warning: null, menuOpen: false },
);

const emit = defineEmits<{
    add: [];
    'set-status': [status: UserRateStatus];
    remove: [];
    'update:menuOpen': [open: boolean];
}>();

const card = computed(() => props.item.card);

// One name only (the setting decides which): the second one costs 17,5px on
// every row, and this screen is bought with exactly that space.
const { settings } = useSettings();
const title = computed(() => displayTitle(card.value, settings.value.titleLang).primary);

// Link to the title page (Ф6-26): server data, https only, null = render the
// name as plain text.
const href = computed(() => titleHref(card.value.url));

// The poster repeats the destination of the title link, so it stays out of the
// tab order and the a11y tree.
const posterLinkAttrs = computed((): Record<string, string> => {
    const url = href.value;
    if (url === null) {
        return {};
    }
    return {
        href: url,
        target: '_blank',
        rel: 'noopener noreferrer',
        tabindex: '-1',
        'aria-hidden': 'true',
    };
});

// The list mixes anime, manga and ranobe, so the wording follows the ROW, not
// the title the screen was opened from: a manga row reads «Читаю».
const media = computed(() => mediaOf(card.value.targetType));

const addLabel = computed(() => `+ ${statusLabel(settings.value.quickStatus, media.value)}`);

// 0.0 means "no score yet" (announcements) — hidden, as in the search card.
const scoreText = computed(() =>
    card.value.score && card.value.score > 0 ? card.value.score.toFixed(1) : null,
);

const posterSrc = computed(() => card.value.posterUrl || posterFallback);

const posterSrcset = computed(() =>
    card.value.posterUrl && card.value.posterUrl2x
        ? `${card.value.posterUrl} 1x, ${card.value.posterUrl2x} 2x`
        : undefined,
);

// «Другая история · TV-спешл · 2000». The server's relationText leads: on some
// links it is more precise than any generic group heading, and it belongs to
// the row it describes. Then the TYPE of the title — the one thing a mixed list
// must not lose — and the year. Episode counts and «Вышло» are dropped: their
// place is taken by the relation the screen was opened for.
const meta = computed(() => {
    const parts: string[] = [];
    if (props.item.relationText) {
        parts.push(props.item.relationText);
    }
    const kind = kindLabel(card.value.kind);
    if (kind) {
        parts.push(kind);
    }
    if (card.value.year !== null) {
        parts.push(String(card.value.year));
    }
    return parts.join(' · ');
});

function toggleMenu(): void {
    emit('update:menuOpen', !props.menuOpen);
}

function onSelect(status: UserRateStatus): void {
    emit('update:menuOpen', false);
    // Re-picking the current status is a no-op: no pointless write, no rate
    // spend (same rule as RateRow).
    if (status !== card.value.userRate?.status) {
        emit('set-status', status);
    }
}

function onRemove(): void {
    emit('update:menuOpen', false);
    emit('remove');
}
</script>

<style scoped lang="scss">
.related-row {
    display: flex;
    gap: 12px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--color-border);
}

.related-row__poster-box {
    /* Wrapper of the poster: no size of its own, only the flex behaviour (same
       as TitleCard/RateRow). */
    display: flex;
    flex-shrink: 0;
    align-self: flex-start;
    border-radius: 5px;
}

a.related-row__poster-box:hover .related-row__poster {
    opacity: 0.75;
}

.related-row__poster--placeholder {
    opacity: var(--poster-placeholder-opacity, 1);
}

.related-row__poster {
    /* 42×58 as in RateRow, not the 60×94 of the search card: here a title is
       not examined, it is picked out of a list. */
    flex-shrink: 0;
    width: 42px;
    height: 58px;
    border-radius: 5px;
    background: var(--color-surface);
    object-fit: cover;
}

.related-row__body {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
}

.related-row__title-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
}

/* ONE line with an ellipsis, unlike the two-line clamp of TitleCard/RateRow:
   the whole point of this screen is how many rows fit the frame. The full name
   stays in `title` and on the site behind the link. */
.related-row__title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    margin: 0;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 13.5px;
    font-weight: 600;
    line-height: 1.3;
}

/* The link wears the look of the heading it sits in; the focus ring is the
   plain outward one of the foundation — a single line clips nothing, so there
   is nothing to move inward here. */
.related-row__title-link {
    color: inherit;
    text-decoration: none;

    &:hover {
        text-decoration: underline;
    }
}

.related-row__score {
    flex-shrink: 0;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--color-accent);
    font-variant-numeric: tabular-nums;
}

.related-row__meta {
    margin: 2px 0 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 12px;
    color: var(--color-fg-muted);
}

.related-row__control {
    /* Anchor of the fixed StatusMenu (use-popover-position takes the parent of
       the popover), left-aligned so the 200px menu always fits the 380px popup.
       min-height equalizes the two variants: the badge is 21,39px tall and the
       split button 22 — without it the list would jitter by 1,4px depending on
       whether a title is in my lists. */
    position: relative;
    display: flex;
    align-items: center;
    min-height: 23px;
    margin-top: 4px;
}

.related-row__split {
    display: inline-flex;
}

.related-row__add,
.related-row__caret {
    padding: 3px 9px;
    border: 1px solid var(--color-accent);
    background: var(--color-accent);
    color: var(--color-accent-fg);
    font: inherit;
    font-size: 12px;
    font-weight: 600;

    &:hover:not(:disabled) {
        background: var(--color-accent-hover);
        border-color: var(--color-accent-hover);
    }
}

.related-row__add {
    border-radius: 6px 0 0 6px;
}

.related-row__caret {
    padding: 3px 7px;
    border-left: 1px solid rgb(255 255 255 / 35%);
    border-radius: 0 6px 6px 0;
}

/* Compact pill sizes on top of the global .badge, as in RateRow. */
.related-row__badge {
    flex-shrink: 0;
    gap: 5px;
    padding: 2px 8px 2px 7px;
    font-size: 11px;
    white-space: nowrap;

    &:hover:not(:disabled) {
        border-color: var(--sc);
    }

    &:focus-visible {
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

/* Inline warning per the screens-states card, tightened to the density of this
   row. */
.related-row__warning {
    margin: 6px 0 0;
    padding: 7px 10px;
    border: 1px solid color-mix(in srgb, var(--color-danger) 35%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, var(--color-danger) 12%, transparent);
    color: var(--color-danger);
    font-size: 12px;
}
</style>
