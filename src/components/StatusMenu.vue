<template>
    <div
        ref="menuEl"
        class="menu"
        :class="{ 'menu--up': openUp }"
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
            {{ statusLabel(s) }}
            <span
                v-if="s === current"
                class="menu__check"
                aria-hidden="true"
                >✓</span
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
                class="menu__cross"
                aria-hidden="true"
                >×</span
            >
            {{ i18n.actions.removeFromList }}
        </button>
    </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { UserRateStatus } from '@/src/lib/api/types';
import { i18n, statusLabel } from '@/src/lib/i18n';

// Dropdown with the 6 user rate statuses (US-3 order) + "remove from list"
// for titles already in my list. Purely presentational: the parent owns the
// open/closed state and the actual mutation.
defineProps<{
    // Current status of the title, null when it is not in my list
    // (hides "remove" and the current-item marker).
    current: UserRateStatus | null;
}>();

const emit = defineEmits<{
    select: [status: UserRateStatus];
    remove: [];
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
// Flip upwards when the menu would overflow the popup bottom edge.
const openUp = ref(false);

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
    // Measured after insertion but before paint: no visible jump.
    const rect = menuEl.value?.getBoundingClientRect();
    if (rect && rect.bottom > window.innerHeight - 8) {
        openUp.value = true;
    }
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
   separated by a top border. */
.menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 10;
    overflow: hidden;
    width: 200px;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    background: var(--color-bg);
    box-shadow: 0 6px 20px rgb(0 0 0 / 14%);
}

.menu--up {
    top: auto;
    bottom: calc(100% + 4px);
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
    cursor: pointer;

    &:hover {
        background: var(--color-surface);
    }

    &:focus-visible {
        outline: 2px solid var(--color-accent);
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

.menu__item--danger {
    border-top: 1px solid var(--color-border);
    color: var(--color-danger);
}

.menu__cross {
    flex: 0 0 auto;
    width: 9px;
    text-align: center;
}
</style>
