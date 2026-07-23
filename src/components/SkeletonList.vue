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
                <span class="skeleton__line skeleton__line--title"></span>
                <span class="skeleton__line skeleton__line--meta"></span>
                <span class="skeleton__line skeleton__line--action"></span>
            </span>
        </div>
    </div>
</template>

<script setup lang="ts">
// Loading placeholder that mirrors the TitleCard layout (docs/05: 3-5 rows).
withDefaults(defineProps<{ count?: number }>(), { count: 4 });
</script>

<style scoped lang="scss">
.skeleton__row {
    display: flex;
    gap: 10px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--color-border);
}

.skeleton__poster {
    /* Same fixed box as the real poster: no shift when data arrives. */
    flex-shrink: 0;
    width: 60px;
    height: 94px;
    border-radius: 4px;
    background: var(--color-surface);
    animation: skeleton-pulse 1.4s ease-in-out infinite;
}

.skeleton__lines {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 10px;
    padding-top: 4px;
}

.skeleton__line {
    height: 12px;
    border-radius: 6px;
    background: var(--color-surface);
    animation: skeleton-pulse 1.4s ease-in-out infinite;
}

.skeleton__line--title {
    width: 75%;
}

.skeleton__line--meta {
    width: 55%;
}

.skeleton__line--action {
    width: 40%;
    height: 22px;
    margin-top: auto;
    border-radius: 6px;
}

@keyframes skeleton-pulse {
    0%,
    100% {
        opacity: 1;
    }

    50% {
        opacity: 0.55;
    }
}

@media (prefers-reduced-motion: reduce) {
    .skeleton__poster,
    .skeleton__line {
        animation: none;
    }
}
</style>
