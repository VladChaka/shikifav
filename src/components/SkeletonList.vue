<template>
    <div
        class="skeleton"
        aria-hidden="true"
    >
        <div
            v-for="i in count"
            :key="i"
            class="skeleton__row"
        >
            <span class="skeleton__poster"></span>
            <span class="skeleton__lines">
                <span class="skeleton__line"></span>
                <span class="skeleton__line skeleton__line--short"></span>
            </span>
        </div>
    </div>
</template>

<script setup lang="ts">
// Loading placeholder per the screens-states card (docs/05: 3-5 rows):
// poster stub + two pulsing bars.
withDefaults(defineProps<{ count?: number }>(), { count: 4 });
</script>

<style scoped lang="scss">
.skeleton__row {
    display: flex;
    gap: 10px;
    padding: 12px;
    border-bottom: 1px solid var(--color-border);
}

.skeleton__poster {
    flex-shrink: 0;
    width: 40px;
    height: 56px;
    border-radius: 5px;
    background: var(--color-surface);
    animation: skeleton-pulse 1.4s ease-in-out infinite;
}

.skeleton__lines {
    display: flex;
    flex: 1;
    flex-direction: column;
    justify-content: center;
    gap: 7px;
}

.skeleton__line {
    height: 10px;
    border-radius: 5px;
    background: var(--color-surface);
    animation: skeleton-pulse 1.4s ease-in-out infinite;
}

.skeleton__line--short {
    width: 60%;
}

@keyframes skeleton-pulse {
    0%,
    100% {
        opacity: 1;
    }

    50% {
        opacity: 0.45;
    }
}

@media (prefers-reduced-motion: reduce) {
    .skeleton__poster,
    .skeleton__line {
        animation: none;
    }
}
</style>
