<template>
    <div
        class="toast"
        role="status"
        @click="close"
    >
        {{ text }}
    </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue';

// Bottom toast for non-blocking errors (optimistic update rollback, Ф2-7).
// The parent owns visibility: renders with v-if and removes it on `closed`.
// Click dismisses early.
const props = withDefaults(defineProps<{ text: string; duration?: number }>(), {
    duration: 4000,
});

const emit = defineEmits<{
    closed: [];
}>();

let timer: ReturnType<typeof setTimeout> | undefined;

function close(): void {
    if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
    }
    emit('closed');
}

function armTimer(): void {
    if (timer !== undefined) {
        clearTimeout(timer);
    }
    timer = setTimeout(close, props.duration);
}

onMounted(armTimer);

// A new message may replace the text while the toast is visible (Ф2-7):
// restart the countdown so the fresh message gets the full duration.
watch(() => props.text, armTimer);

onBeforeUnmount(() => {
    if (timer !== undefined) {
        clearTimeout(timer);
    }
});
</script>

<style scoped lang="scss">
.toast {
    position: fixed;
    right: 12px;
    bottom: 12px;
    left: 12px;
    z-index: 20;
    padding: 9px 14px;
    border-radius: 8px;
    /* Inverse colors (components-atoms card): readable in both themes. */
    background: var(--color-fg);
    color: var(--color-bg);
    font-size: 13px;
    box-shadow: 0 4px 14px rgb(0 0 0 / 18%);
    cursor: pointer;
    animation: toast-in 0.15s ease-out;
}

@keyframes toast-in {
    from {
        opacity: 0;
        transform: translateY(6px);
    }

    to {
        opacity: 1;
        transform: translateY(0);
    }
}

@media (prefers-reduced-motion: reduce) {
    .toast {
        animation: none;
    }
}
</style>
