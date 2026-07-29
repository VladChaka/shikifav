<template>
    <article class="rate">
        <!-- Poster box: an <a> to the title page when there is one, a plain
             <div> of the same geometry otherwise (same rule as TitleCard). -->
        <component
            :is="href ? 'a' : 'div'"
            class="rate__poster-box"
            v-bind="posterLinkAttrs"
        >
            <img
                class="rate__poster"
                :class="{ 'rate__poster--placeholder': !rate.posterUrl }"
                :src="posterSrc"
                :srcset="posterSrcset"
                width="42"
                height="58"
                loading="lazy"
                alt=""
            />
        </component>

        <div class="rate__body">
            <div class="rate__title-row">
                <h3
                    class="rate__title"
                    :title="title"
                >
                    <a
                        v-if="href"
                        class="rate__title-link"
                        :href="href"
                        target="_blank"
                        rel="noopener noreferrer"
                        >{{ title }}</a
                    >
                    <template v-else>{{ title }}</template>
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
                <!-- Progress (Ф7-16): the whole phrase is the trigger, but only
                     the number becomes a field — the total and the unit stay
                     put, so the ceiling is in front of the eyes while typing. -->
                <span class="rate__progress">
                    <button
                        v-if="!editing"
                        ref="triggerEl"
                        class="rate__progress-btn"
                        type="button"
                        :disabled="busy"
                        :aria-label="editProgressLabel"
                        :title="editProgressLabel"
                        @click="openEditor"
                    >
                        <span class="rate__progress-value">{{ rate.progress }}</span>
                        <span class="rate__progress-tail">{{ progressTail }}</span>
                    </button>
                    <template v-else>
                        <!-- type="text", not "number": the spinners are junk in
                             44px, the mouse wheel over a focused number field
                             edits it inside a scrolling list, and junk input
                             comes back as an empty string with nothing left to
                             point at. -->
                        <input
                            ref="inputEl"
                            class="rate__progress-input"
                            :class="{ 'rate__progress-input--invalid': invalid }"
                            type="text"
                            inputmode="numeric"
                            :maxlength="MAX_DIGITS"
                            autocomplete="off"
                            :value="draft"
                            :aria-label="progressFieldLabel"
                            :aria-invalid="invalid ? 'true' : undefined"
                            :aria-describedby="tailId"
                            :title="i18n.rates.progressHint"
                            @input="onInput"
                            @keydown="onKeydown"
                            @blur="closeEditor(false)"
                        />
                        <!-- Same slot as the rest-state tail: out of range it
                             says the limit out loud, so neither the height nor
                             the layout of the row changes (no toast — the error
                             belongs to the row that made it). -->
                        <span
                            :id="tailId"
                            class="rate__progress-tail"
                            :class="{ 'rate__progress-tail--invalid': invalid }"
                            >{{ invalid ? maxHint : progressTail }}</span
                        >
                    </template>
                </span>
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
import { computed, nextTick, ref, useId, watch } from 'vue';
import ScorePicker from '@/src/components/ScorePicker.vue';
import StatusMenu from '@/src/components/StatusMenu.vue';
import posterFallback from '@/src/assets/poster-fallback.png';
import { useSettings } from '@/src/composables/use-settings';
import type { RateRow, UserRateStatus } from '@/src/lib/api/types';
import { i18n, mediaOf, statusLabel } from '@/src/lib/i18n';
import { displayTitle } from '@/src/lib/title-name';
import { titleHref } from '@/src/lib/title-url';

// "Мои списки" list row (US-4/5/6 + Ф3-7 status badge). Presentational only:
// progress, +1, score, status change/removal and the "completed?" suggestion
// are emitted upwards; `busy` locks all actions while a write is in flight and
// `suggestCompleted` toggles the inline offer. `scoreOpen`/`statusOpen` are
// parent-owned (at most one popover open across the list, same discipline as
// TitleCard's menuOpen).
//
// Emits:
//   increment                — user pressed [+1]
//   set-progress(value)      — an absolute progress number was typed and
//                              confirmed with Enter (Ф7-16)
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
    'set-progress': [value: number];
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

// Link to the title page on Shikimori (Ф6-26), same contract as in TitleCard:
// the url is API data on the current origin, null = nothing to link to (old
// session cache or a non-https value). The poster link duplicates it and stays
// out of the tab order / a11y tree.
const href = computed(() => titleHref(props.rate.url));

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

// Wording follows the row media (phase 4): anime counts episodes
// («эп.», «+1 эпизод», «Просмотрено»), manga/ranobe count chapters
// («гл.», «+1 глава», «Прочитано»).
const media = computed(() => mediaOf(props.rate.targetType));

// Last step of the poster chain (Ф6-27), same rule as in TitleCard: GraphQL
// poster -> REST backfill -> this local file.
const posterSrc = computed(() => props.rate.posterUrl || posterFallback);

const posterSrcset = computed(() =>
    props.rate.posterUrl && props.rate.posterUrl2x
        ? `${props.rate.posterUrl} 1x, ${props.rate.posterUrl2x} 2x`
        : undefined,
);

// Static half of the progress phrase: "/ 12 эп." (or "гл.") when the total is
// known, bare "эп." when total == 0 (unknown/ongoing). It stands still while the
// number in front of it is being edited.
const progressTail = computed(() => {
    const { total } = props.rate;
    const unit = media.value === 'book' ? i18n.card.chaptersShort : i18n.card.episodesShort;
    return total > 0 ? `/ ${total} ${unit}` : unit;
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

// --- Ф7-16: inline progress editor -----------------------------------------
// Unlike [+1] the field is offered at every status: where the user stopped has
// to be recordable in «Отложено» and «Брошено» too. The editor is local view
// state — the row still emits one absolute number and never touches the network.

// "1147" plus a caret fits the 44px field; a longer number is not a real
// episode count, it is a typo.
const MAX_DIGITS = 4;

const editing = ref(false);
// Raw field text (digits only, may be empty mid-typing) — not a number, so a
// half-typed value never masquerades as progress.
const draft = ref('');
const inputEl = ref<HTMLInputElement | null>(null);
const triggerEl = ref<HTMLButtonElement | null>(null);
// The tail describes the field (the unit, or the ceiling when out of range).
const tailId = useId();

const editProgressLabel = computed(() =>
    media.value === 'book' ? i18n.rates.editProgressChapter : i18n.rates.editProgress,
);

const progressFieldLabel = computed(() =>
    media.value === 'book' ? i18n.rates.progressLabelChapter : i18n.rates.progressLabel,
);

// total == 0 means the maximum was never announced (One Piece and friends), so
// there is no upper bound at all — the same rule [+1] follows.
const maxProgress = computed(() => (props.rate.total > 0 ? props.rate.total : null));

const maxHint = computed(() => `${i18n.rates.progressMaxPrefix} ${props.rate.total}`);

// The field holds digits only (input filter), so an empty string is its only
// non-numeric state — and an empty field is mid-typing, not an error.
const parsedDraft = computed(() => (draft.value === '' ? null : Number(draft.value)));

const invalid = computed(() => {
    const value = parsedDraft.value;
    const max = maxProgress.value;
    return value !== null && max !== null && value > max;
});

function openEditor(): void {
    if (props.busy || editing.value) {
        return;
    }
    draft.value = String(props.rate.progress);
    editing.value = true;
    void nextTick(() => {
        inputEl.value?.focus();
        // The current value comes preselected: typing replaces it outright.
        inputEl.value?.select();
    });
}

// Cancel. focusTrigger only for Esc: on blur the user is already somewhere else
// and pulling the caret back would fight them.
function closeEditor(focusTrigger: boolean): void {
    if (!editing.value) {
        return;
    }
    editing.value = false;
    if (focusTrigger) {
        void nextTick(() => triggerEl.value?.focus());
    }
}

// Set by commit(): the caret owed back to the trigger, waiting for the write to
// finish. Only a write this editor started arms it — the caret after [+1], a
// score or a status change belongs to the control the user pressed there.
let refocusAfterWrite = false;

function commit(): void {
    if (invalid.value) {
        // Nothing written and the field stays open: the caret keeps its place
        // and the number does not have to be retyped.
        return;
    }
    const value = parsedDraft.value;
    if (value === null || value === props.rate.progress) {
        // Empty field or the very same number — closing costs no request.
        closeEditor(true);
        return;
    }
    // The write locks the row, so the caret is not handed back to a trigger
    // that is about to be disabled — the watch below does it once busy lifts.
    refocusAfterWrite = true;
    closeEditor(false);
    emit('set-progress', value);
}

// Saving with Enter leaves the focus on <body> (the trigger was disabled at
// that moment), from where the next Tab would restart at the top of the
// document. Post-flush: while the prop is being applied the button is still
// disabled, and focus() on a disabled button does nothing.
watch(
    () => props.busy,
    (busy) => {
        if (busy || !refocusAfterWrite) {
            return;
        }
        refocusAfterWrite = false;
        // Anywhere but <body> means the user went somewhere themselves while
        // the write was in flight — their focus wins.
        if (document.activeElement === document.body) {
            triggerEl.value?.focus();
        }
    },
    { flush: 'post' },
);

function onInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    // Digits only: maxlength covers typing, this also survives a paste.
    const digits = input.value.replace(/\D+/g, '').slice(0, MAX_DIGITS);
    draft.value = digits;
    if (input.value !== digits) {
        // The bound value did not change, so Vue would not patch the DOM back.
        input.value = digits;
    }
}

function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
        event.preventDefault();
        commit();
        return;
    }
    if (event.key === 'Escape') {
        event.preventDefault();
        closeEditor(true);
    }
}

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

.rate__poster-box {
    /* Wrapper of the poster (Ф6-26): no size of its own, only the flex
       behaviour the poster used to have as a direct row child. */
    display: flex;
    flex-shrink: 0;
    align-self: flex-start;
    border-radius: 5px;
}

/* Hover of the poster link: the same fade toward the page background as in
   TitleCard. */
a.rate__poster-box:hover .rate__poster {
    opacity: 0.75;
}

/* Placeholder only: dimmed on the dark theme through the foundation
   variable (default 1 elsewhere), so a white sheet of paper does not
   glow in a dark list. Hover keeps its own fade above — the two never
   apply to the same element at once, so they do not compound. */
.rate__poster--placeholder {
    opacity: var(--poster-placeholder-opacity, 1);
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
    /* Up to two lines, then ellipsis; the clipping stays tight and the focus
       ring of the title link is moved inward, exactly as in TitleCard. */
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

/* Same rule as .card__title-link: the link looks like the heading it sits in,
   only the hover underline marks it. */
.rate__title-link {
    color: inherit;
    text-decoration: none;

    &:hover {
        text-decoration: underline;
    }

    /* Same reason as .card__title-link: the clamped heading clips an outward
       ring, so this one is drawn just inside the text box. */
    &:focus-visible {
        outline-offset: -1px;
    }
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

    &:hover:not(:disabled) {
        border-color: var(--color-accent);
    }

    /* Tighter than the default ring of the foundation: a 2px control in a
       12px-padded row would otherwise touch the title above it. */
    &:focus-visible {
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

/* The only element of the row that changes shape (Ф7-16): in rest it holds the
   phrase button, while editing — the field and the same tail. */
.rate__progress {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    font-size: 12px;
    color: var(--color-fg-muted);
}

/* Rest state: the trigger is the whole phrase (a single digit is 7.6px wide at
   this size, the phrase is 55.8x20.8), and it costs nothing horizontally —
   vertical padding only, no border, no background — so the progress line stands
   exactly where it stood before the editor existed. */
.rate__progress-btn {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    min-width: 0;
    padding: 2px 0;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    white-space: nowrap;

    /* Hover answers with one change only: the muted phrase takes the row text
       color (the bordered controls of the row answer with an accent border, a
       borderless one answers with color). */
    &:hover:not(:disabled) {
        color: var(--color-fg);
    }

    /* Tighter than the default ring of the foundation, as everywhere in this
       dense row. */
    &:focus-visible {
        outline-offset: 1px;
    }
}

/* The only rest-state mark of "this is editable": a dashed underline under the
   number that is edited. Not a border and not a fill — the row already carries
   two bordered controls and a pill. */
.rate__progress-value {
    text-decoration: underline;
    text-decoration-style: dashed;
    text-decoration-color: color-mix(in srgb, currentcolor 65%, transparent);
    text-underline-offset: 2px;
    font-variant-numeric: tabular-nums;
}

/* The field replaces the number and only the number. Fixed width (4 digits fit):
   a content-sized field would twitch the tail on every keystroke. Height is
   exactly the 20.8px of the trigger it replaced (1px padding + 1px border over
   the same 12px/1.4 text), so the row does not grow while typing. */
.rate__progress-input {
    /* The tail is the only part of the line allowed to give way (it truncates),
       so the field keeps its width and the typed number stays fully visible. */
    flex-shrink: 0;
    width: 44px;
    padding: 1px 4px;
    border: 1px solid var(--color-accent);
    border-radius: 4px;
    background: var(--color-bg);
    color: var(--color-fg);
    font: inherit;
    line-height: 1.4;
    font-variant-numeric: tabular-nums;

    /* The soft ring is a shadow, not an outline: it must not take part in the
       layout of an already cramped line. */
    outline: none;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 22%, transparent);
}

.rate__progress-input--invalid {
    border-color: var(--color-danger);
    color: var(--color-danger);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-danger) 22%, transparent);
}

/* The static half of the phrase. Its ellipsis is the deliberate degradation
   order of the line: [+1], the score and the badge never move, the repeated
   maximum truncates. */
.rate__progress-tail {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}

.rate__progress-tail--invalid {
    color: var(--color-danger);
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

    &:hover:not(:disabled) {
        border-color: var(--color-accent);
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

    &:hover:not(:disabled) {
        border-color: var(--sc);
    }

    /* Tighter than the default ring of the foundation: the pill sits flush
       against the right edge of the row. */
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

    &:hover:not(:disabled) {
        text-decoration: underline;
    }

    /* Tighter than the default ring of the foundation: a borderless link
       button, the 2px default would read as a box around the text. */
    &:focus-visible {
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
