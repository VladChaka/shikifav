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
            <button
                v-if="current > 0"
                class="picker__item picker__item--remove"
                type="button"
                role="menuitem"
                @click="emit('select', 0)"
            >
                {{ i18n.score.remove }}
            </button>
        </div>
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
/* components-menus card (ScorePicker): 30x30 squares, 5 per row,
   selected — accent fill, "Снять оценку" — danger. */
.picker {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 10;
    padding: 8px;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    background: var(--color-bg);
    box-shadow: 0 6px 20px rgb(0 0 0 / 14%);
}

.picker--up {
    top: auto;
    bottom: calc(100% + 4px);
}

.picker__grid {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    /* Exactly 5 squares per row: 5 * 30px + 4 * 6px. */
    width: 174px;
}

.picker__item {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: var(--color-bg);
    color: var(--color-fg);
    font: inherit;
    cursor: pointer;

    &:hover {
        background: var(--color-surface);
        outline: 2px solid var(--color-accent);
        outline-offset: -1px;
    }

    &:focus-visible {
        outline: 2px solid var(--color-accent);
        outline-offset: -1px;
    }
}

.picker__item--current {
    border-color: var(--color-accent);
    background: var(--color-accent);
    color: var(--color-accent-fg);
    font-weight: 600;

    &:hover {
        background: var(--color-accent-hover);
    }
}

.picker__item--remove {
    width: auto;
    padding: 0 10px;
    color: var(--color-danger);
}
</style>
