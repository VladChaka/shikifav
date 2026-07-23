<template>
    <div class="error">
        <p
            class="error__text"
            role="alert"
        >
            {{ text }}
        </p>
        <button
            class="error__retry"
            type="button"
            @click="emit('retry')"
        >
            {{ i18n.actions.retry }}
        </button>
    </div>
</template>

<script setup lang="ts">
import { i18n } from '@/src/lib/i18n';

// List-level error state (docs/05): message mapped from ApiError.kind by the
// parent (apiErrorMessage) + a retry action.
defineProps<{ text: string }>();

const emit = defineEmits<{
    retry: [];
}>();
</script>

<style scoped lang="scss">
.error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    min-height: 120px;
    padding: 16px;
    gap: 12px;
}

.error__text {
    margin: 0;
    max-width: 280px;
    font-size: 13px;
    color: var(--color-danger);
    text-align: center;
}

.error__retry {
    padding: 6px 16px;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: var(--color-surface);
    color: var(--color-fg);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;

    &:hover {
        border-color: var(--color-accent);
    }

    &:focus-visible {
        outline: 2px solid var(--color-accent);
        outline-offset: 2px;
    }
}
</style>
