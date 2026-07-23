<template>
    <div
        ref="pickerEl"
        class="picker"
        :class="{ 'picker--up': openUp }"
        role="menu"
    >
        <div class="picker__grid">
            <button
                v-for="n in 10"
                :key="n"
                class="picker__item"
                :class="{ 'picker__item--current': n === current }"
                type="button"
                role="menuitemradio"
                :aria-checked="n === current"
                @click="emit('select', n)"
            >
                {{ n }}
            </button>
        </div>
        <template v-if="current > 0">
            <div
                class="picker__divider"
                role="separator"
            ></div>
            <button
                class="picker__item picker__item--remove"
                type="button"
                role="menuitem"
                @click="emit('select', 0)"
            >
                {{ i18n.score.remove }}
            </button>
        </template>
    </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { i18n } from '@/src/lib/i18n';

// Score picker (US-5, docs/05): 1–10 grid + "снять оценку" (0). Purely
// presentational — the parent owns open/closed state and applies the write.
// Positioning/close mechanics mirror StatusMenu (outside-click, Esc, flip-up).
//
// Props: current — current score (0 = no score, hides "снять оценку").
// Emits: select(value) — a score 0..10 was chosen; close — dismissed.
defineProps<{ current: number }>();

const emit = defineEmits<{
    select: [value: number];
    close: [];
}>();

const pickerEl = ref<HTMLElement | null>(null);
// Flip upwards when the picker would overflow the popup bottom edge.
const openUp = ref(false);

function onDocumentClick(event: MouseEvent): void {
    // The trigger button uses @click.stop, so a click reaching the document is
    // either inside the picker (handled by items) or truly outside.
    if (pickerEl.value && !pickerEl.value.contains(event.target as Node)) {
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
    const rect = pickerEl.value?.getBoundingClientRect();
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
.picker {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 10;
    padding: 4px;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    background: var(--color-bg);
    box-shadow: 0 4px 16px rgb(0 0 0 / 20%);
}

.picker--up {
    top: auto;
    bottom: calc(100% + 4px);
}

.picker__grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 2px;
}

.picker__item {
    padding: 5px 8px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--color-fg);
    font: inherit;
    font-size: 13px;
    text-align: center;
    cursor: pointer;

    &:hover {
        background: var(--color-surface);
    }

    &:focus-visible {
        outline: 2px solid var(--color-accent);
        outline-offset: -2px;
    }
}

.picker__item--current {
    font-weight: 600;
    color: var(--color-accent-fg);
    background: var(--color-accent);

    &:hover {
        background: var(--color-accent-hover);
    }
}

.picker__item--remove {
    width: 100%;
    color: var(--color-danger);
    text-align: left;
}

.picker__divider {
    height: 1px;
    margin: 4px 6px;
    background: var(--color-border);
}
</style>
