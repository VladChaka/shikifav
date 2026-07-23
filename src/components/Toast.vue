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
import { onBeforeUnmount, onMounted } from 'vue';

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

onMounted(() => {
    timer = setTimeout(close, props.duration);
});

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
    padding: 10px 14px;
    border-radius: 8px;
    /* Inverse colors: readable in both themes without extra variables. */
    background: var(--color-fg);
    color: var(--color-bg);
    font-size: 13px;
    box-shadow: 0 4px 16px rgb(0 0 0 / 25%);
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
