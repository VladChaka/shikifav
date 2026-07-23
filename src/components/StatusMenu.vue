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
            :class="{ 'menu__item--current': s === current }"
            type="button"
            role="menuitemradio"
            :aria-checked="s === current"
            @click="emit('select', s)"
        >
            {{ statusLabel(s) }}
        </button>
        <template v-if="current !== null">
            <div
                class="menu__divider"
                role="separator"
            ></div>
            <button
                class="menu__item menu__item--danger"
                type="button"
                role="menuitem"
                @click="emit('remove')"
            >
                {{ i18n.actions.removeFromList }}
            </button>
        </template>
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
.menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 10;
    min-width: 180px;
    padding: 4px;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    background: var(--color-bg);
    box-shadow: 0 4px 16px rgb(0 0 0 / 20%);
}

.menu--up {
    top: auto;
    bottom: calc(100% + 4px);
}

.menu__item {
    display: block;
    width: 100%;
    padding: 5px 10px;
    border: none;
    border-radius: 5px;
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

.menu__item--current {
    font-weight: 600;
    color: var(--color-accent);
}

.menu__item--danger {
    color: var(--color-danger);
}

.menu__divider {
    height: 1px;
    margin: 4px 6px;
    background: var(--color-border);
}
</style>
