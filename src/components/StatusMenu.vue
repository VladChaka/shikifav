<template>
    <div
        ref="menuEl"
        class="menu"
        role="menu"
    >
        <button
            v-for="s in STATUSES"
            :key="s"
            class="menu__item"
            :class="[`st-${s}`, { 'menu__item--current': s === current }]"
            type="button"
            role="menuitemradio"
            :aria-checked="s === current"
            @click="emit('select', s)"
        >
            <span
                class="menu__dot"
                aria-hidden="true"
            ></span>
            {{ statusLabel(s, media) }}
            <span
                v-if="s === current"
                class="menu__check"
                aria-hidden="true"
                >✓</span
            >
        </button>
        <!-- Ф12, second approved way into «Связанные»: after the statuses (the
             reason the menu was opened stays first under the cursor) and before
             the removal, in ascending price of a misclick. Rendered only where
             there is an overlay to open — the related screen itself passes
             nothing, because it must not lead from one title's links to
             another's (docs/06, decision 4). -->
        <button
            v-if="withRelated"
            class="menu__item menu__item--nav"
            type="button"
            role="menuitem"
            @click="emit('related')"
        >
            <span
                class="menu__glyph"
                aria-hidden="true"
                >⧉</span
            >
            {{ i18n.related.open }}
            <span
                class="menu__chevron"
                aria-hidden="true"
                >›</span
            >
        </button>
        <button
            v-if="current !== null"
            class="menu__item menu__item--danger"
            type="button"
            role="menuitem"
            @click="emit('remove')"
        >
            <span
                class="menu__glyph"
                aria-hidden="true"
                >×</span
            >
            {{ i18n.actions.removeFromList }}
        </button>
    </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { usePopoverPosition } from '@/src/composables/use-popover-position';
import type { UserRateStatus } from '@/src/lib/api/types';
import { i18n, statusLabel } from '@/src/lib/i18n';
import type { MediaKind } from '@/src/lib/i18n';

// Dropdown with the 6 user rate statuses (US-3 order) + "remove from list"
// for titles already in my list + the way into «Связанные» (Ф12). Purely
// presentational: the parent owns the open/closed state and the actual mutation.
withDefaults(
    defineProps<{
        // Current status of the title, null when it is not in my list
        // (hides "remove" and the current-item marker).
        current: UserRateStatus | null;
        // Wording variant: anime «Смотрю/Просмотрено», book «Читаю/Прочитано»
        // for manga/ranobe (phase 4).
        media?: MediaKind;
        // Ф12: show «Связанные тайтлы». Off by default so a menu whose host
        // cannot open the overlay — the related screen itself, and the
        // full-screen search page — never draws a dead item; the two hosts
        // that can say so explicitly.
        withRelated?: boolean;
    }>(),
    { media: 'anime', withRelated: false },
);

const emit = defineEmits<{
    select: [status: UserRateStatus];
    remove: [];
    related: [];
    close: [];
}>();

const STATUSES: readonly UserRateStatus[] = [
    'planned',
    'watching',
    'rewatching',
    'completed',
    'on_hold',
    'dropped',
];

const menuEl = ref<HTMLElement | null>(null);

// Fixed positioning against the trigger wrapper: the card lives in a scroll
// container that would clip an absolutely positioned menu (Ф6-24). Flipping
// above the anchor near the window bottom is part of the placement.
usePopoverPosition(menuEl, {
    align: 'start',
    gap: 4,
    onAnchorHidden: () => emit('close'),
});

function onDocumentClick(event: MouseEvent): void {
    // The trigger button uses @click.stop, so a click reaching the document
    // is either inside the menu (handled by items) or truly outside.
    if (menuEl.value && !menuEl.value.contains(event.target as Node)) {
        emit('close');
    }
}

function onDocumentKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
        emit('close');
    }
}

onMounted(() => {
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onDocumentKeydown);
});

onBeforeUnmount(() => {
    document.removeEventListener('click', onDocumentClick);
    document.removeEventListener('keydown', onDocumentKeydown);
});
</script>

<style scoped lang="scss">
/* components-menus card: full-bleed items, colored status dots, danger row
   separated by a top border.
   Fixed, not absolute: the scroll container of the tab would clip the menu
   (Ф6-24). top/left come from use-popover-position. */
.menu {
    position: fixed;
    z-index: 10;
    overflow: hidden;
    width: 200px;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    background: var(--color-bg);
    box-shadow: 0 6px 20px rgb(0 0 0 / 14%);
}

.menu__item {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    padding: 8px 12px;
    border: none;
    background: transparent;
    color: var(--color-fg);
    font: inherit;
    font-size: 13px;
    text-align: left;

    &:hover {
        background: var(--color-surface);
    }

    /* Inset ring: full-bleed items, an outset one would be clipped by the
       menu's own overflow: hidden. */
    &:focus-visible {
        outline-offset: -2px;
    }
}

.menu__dot {
    flex: 0 0 auto;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--sc);
}

.menu__item--current {
    font-weight: 600;
}

.menu__check {
    margin-left: auto;
    color: var(--color-accent);
    font-size: 12px;
}

/* Ф12: not a status and it writes nothing — muted, own line above it, and a
   glyph instead of a colored dot, so the six statuses stay one block. */
.menu__item--nav {
    border-top: 1px solid var(--color-border);
    color: var(--color-fg-muted);
}

.menu__chevron {
    margin-left: auto;
    font-size: 11px;
    opacity: 0.7;
}

/* Ф12: the destructive row keeps its line and gains a 6px gap above it. Until
   now one line was enough — above it stood six interchangeable statuses, and a
   misclick cost nothing. With navigation to another screen right above it, two
   neighbours differ in consequence more than any other pair in this UI, so the
   gap gives 6px of dead zone where a click does nothing. It hangs on the danger
   row itself, so every menu with a removal looks the same — including the one
   of the related screen, where the item above is a status again. */
.menu__item--danger {
    margin-top: 6px;
    border-top: 1px solid var(--color-border);
    color: var(--color-danger);
}

/* The column where the statuses draw their dots: ⧉ for the navigation, × for
   the removal. One width (9px) keeps every label on the same vertical. */
.menu__glyph {
    flex: 0 0 auto;
    width: 9px;
    text-align: center;
}
</style>
