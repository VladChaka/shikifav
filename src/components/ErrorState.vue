<template>
    <div class="error">
        <div
            class="error__icon"
            aria-hidden="true"
        >
            ⚠
        </div>
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

// List-level error state per the screens-states card: danger icon + message
// mapped from ApiError.kind by the parent (apiErrorMessage) + a retry action.
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
    padding: 24px;
    gap: 12px;
}

.error__icon {
    color: var(--color-danger);
    font-size: 30px;
    opacity: 0.8;
}

.error__text {
    margin: 0;
    max-width: 280px;
    color: var(--color-danger);
    text-align: center;
}

.error__retry {
    padding: 8px 16px;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    background: transparent;
    color: var(--color-fg);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;

    &:hover {
        background: var(--color-surface);
    }

    &:focus-visible {
        outline: 2px solid var(--color-accent);
        outline-offset: 2px;
    }
}
</style>
