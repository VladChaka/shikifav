<template>
    <article class="cal">
        <!-- Poster box: an <a> to the title page when there is one, a plain
             <div> of the same geometry otherwise (same rule as RateRow). -->
        <component
            :is="href ? 'a' : 'div'"
            class="cal__poster-box"
            v-bind="posterLinkAttrs"
        >
            <img
                class="cal__poster"
                :class="{ 'cal__poster--placeholder': !item.posterUrl }"
                :src="posterSrc"
                :srcset="posterSrcset"
                width="42"
                height="58"
                loading="lazy"
                alt=""
            />
        </component>

        <div class="cal__body">
            <div class="cal__top">
                <h4
                    class="cal__title"
                    :title="title"
                >
                    <a
                        v-if="href"
                        class="cal__title-link"
                        :href="href"
                        target="_blank"
                        rel="noopener noreferrer"
                        >{{ title }}</a
                    >
                    <template v-else>{{ title }}</template>
                </h4>
                <!-- No time in the undated group: the row gives that width back
                     to the title. datetime carries the raw instant from the API,
                     the label is the local clock the schedule layer formatted. -->
                <time
                    v-if="entry.time"
                    class="cal__time"
                    :datetime="item.nextEpisodeAt ?? undefined"
                    >{{ entry.time }}</time
                >
            </div>

            <div class="cal__foot">
                <div class="cal__foot-line">
                    <!-- Missing only when the data contradicts itself (more
                         aired than announced) — the badge then keeps the line. -->
                    <span
                        v-if="episodeText"
                        class="cal__episode"
                        >{{ episodeText }}</span
                    >
                    <!-- Read-only badge (global .badge/.st-*, compact sizes):
                         the tab mixes «Смотрю»/«Пересматриваю» with
                         «Запланировано», and without it those rows are
                         indistinguishable. A <span>, not a button — the calendar
                         changes nothing, so there is no menu and no caret. -->
                    <span
                        class="cal__badge badge"
                        :class="`st-${item.status}`"
                    >
                        <span
                            class="dot"
                            aria-hidden="true"
                        ></span>
                        {{ statusLabel(item.status) }}
                    </span>
                </div>
                <p
                    v-if="behindText"
                    class="cal__behind"
                >
                    {{ behindText }}
                </p>
            </div>
        </div>
    </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import posterFallback from '@/src/assets/poster-fallback.png';
import { useSettings } from '@/src/composables/use-settings';
import type { CalendarItem } from '@/src/lib/api/types';
import type { ScheduleEntry } from '@/src/lib/calendar-schedule';
import { i18n, statusLabel } from '@/src/lib/i18n';
import { displayTitle } from '@/src/lib/title-name';
import { titleHref } from '@/src/lib/title-url';

// One row of the ongoings calendar (US-9, screens/calendar card): poster, title
// link, air time, «Серия N из M», the backlog line and my status badge.
// Read-only and entirely presentational — the row emits nothing, because every
// write lives in «Мои списки» (docs/06, phase 7 scope).
//
// The whole schedule entry is the prop, not its parts: `time`, `episode`,
// `episodesTotal` and `behind` are computed together by
// src/lib/calendar-schedule.ts, and splitting them into props would invite a
// caller to recompute one of them by hand.
const props = defineProps<{ entry: ScheduleEntry<CalendarItem> }>();

const item = computed<CalendarItem>(() => props.entry.item);

// Which name goes first is a setting (docs/05 «Названия»). One line only here:
// the row already carries two metadata lines under the title.
const { settings } = useSettings();
const title = computed(() => displayTitle(item.value, settings.value.titleLang).primary);

// Link to the title page on Shikimori, same contract as in RateRow: the url is
// API data that also survives in the session cache, so only an https value
// becomes a link; null = the row renders as plain text.
const href = computed(() => titleHref(item.value.url));

const posterLinkAttrs = computed((): Record<string, string> => {
    const url = href.value;
    if (url === null) {
        return {};
    }
    // The poster duplicates the title link, so it stays out of the tab order
    // and the a11y tree.
    return {
        href: url,
        target: '_blank',
        rel: 'noopener noreferrer',
        tabindex: '-1',
        'aria-hidden': 'true',
    };
});

// Last step of the poster chain (Ф6-27): GraphQL poster -> REST backfill ->
// this local file.
const posterSrc = computed(() => item.value.posterUrl || posterFallback);

const posterSrcset = computed(() =>
    item.value.posterUrl && item.value.posterUrl2x
        ? `${item.value.posterUrl} 1x, ${item.value.posterUrl2x} 2x`
        : undefined,
);

// «Серия 9 из 16»; with an unknown total (0 from the API) the «из N» half is
// dropped — «Серия 1147».
const episodeText = computed<string | null>(() => {
    const { episode, episodesTotal } = props.entry;
    if (episode === null) {
        return null;
    }
    const head = `${i18n.calendar.episodeWord} ${episode}`;
    return episodesTotal === null ? head : `${head} ${i18n.calendar.outOf} ${episodesTotal}`;
});

// Backlog line, «Смотрю»/«Пересматриваю» only: «Запланировано» cannot be behind
// by definition, and printing it there would read as a reproach for a title the
// user has not started on purpose (screens/calendar card).
const behindText = computed<string | null>(() => {
    const { status, progress, episodesAired } = item.value;
    if (props.entry.behind === null || (status !== 'watching' && status !== 'rewatching')) {
        return null;
    }
    // Zero progress covers both statuses: the general formula would otherwise
    // read «вы на 0-й из 3 вышедших».
    if (progress === 0) {
        return i18n.calendar.behindNotStarted;
    }
    return (
        `${i18n.calendar.behindPrefix} ${progress}${i18n.calendar.behindOrdinal} ` +
        `${i18n.calendar.outOf} ${episodesAired} ${i18n.calendar.behindSuffix}`
    );
});
</script>

<style scoped lang="scss">
.cal {
    display: flex;
    gap: 12px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--color-border);
}

.cal__poster-box {
    /* Wrapper of the poster: no size of its own, only the flex behaviour the
       poster has as a direct row child (same as RateRow). */
    display: flex;
    flex-shrink: 0;
    align-self: flex-start;
    border-radius: 5px;
}

/* Hover of the poster link: the same fade toward the page background as in
   RateRow / TitleCard. */
a.cal__poster-box:hover .cal__poster {
    opacity: 0.75;
}

/* Placeholder only: dimmed on the dark theme through the foundation variable
   (default 1 elsewhere), so a white sheet of paper does not glow in a dark
   list. Hover keeps its own fade above — the two never apply to the same
   element at once, so they do not compound. */
.cal__poster--placeholder {
    opacity: var(--poster-placeholder-opacity, 1);
}

.cal__poster {
    /* Fixed 42x58 box (screens/calendar card): no layout shift while loading. */
    flex-shrink: 0;
    width: 42px;
    height: 58px;
    border-radius: 5px;
    background: var(--color-surface);
    object-fit: cover;
}

.cal__body {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
}

.cal__top {
    display: flex;
    align-items: baseline;
    gap: 8px;
}

.cal__title {
    /* One line, then ellipsis: two metadata lines already sit under it. */
    overflow: hidden;
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: 13.5px;
    font-weight: 600;
    line-height: 1.3;
    white-space: nowrap;
    text-overflow: ellipsis;
}

/* Same rule as .rate__title-link: the link looks like the heading it sits in,
   only the hover underline marks it. */
.cal__title-link {
    color: inherit;
    text-decoration: none;

    &:hover {
        text-decoration: underline;
    }

    /* The clipped heading would cut an outward ring, so it is drawn just inside
       the text box. */
    &:focus-visible {
        outline-offset: -1px;
    }
}

.cal__time {
    /* Own column on the right: inside a day the times read as a column, and
       tabular figures keep four-digit episode numbers from shifting them. */
    flex: 0 0 auto;
    font-size: 13px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
}

.cal__foot {
    /* Pinned to the bottom of the 58px poster box, as the progress row is in
       RateRow. */
    margin-top: auto;
    padding-top: 6px;
}

.cal__foot-line {
    display: flex;
    align-items: center;
    gap: 8px;
}

.cal__episode {
    font-size: 12px;
    color: var(--color-fg-muted);
}

/* Compact pill sizes on top of the global .badge, same as in RateRow — minus
   the hover and the caret, which belong to a button. */
.cal__badge {
    flex-shrink: 0;
    gap: 5px;
    margin-left: auto;
    padding: 2px 8px 2px 7px;
    font-size: 11px;
    white-space: nowrap;

    .dot {
        width: 6px;
        height: 6px;
    }
}

.cal__behind {
    margin: 2px 0 0;
    font-size: 11.5px;
    color: var(--color-fg-muted);
}
</style>
