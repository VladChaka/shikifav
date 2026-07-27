<template>
    <div class="empty">
        <div
            class="empty__icon"
            aria-hidden="true"
        >
            🔍
        </div>
        <p class="empty__text">{{ text }}</p>
    </div>
</template>

<script setup lang="ts">
// Neutral empty state per the screens-states card: dimmed icon + muted text
// ("nothing found" or the empty-query hint, docs/05).
//
// Public style handle (set it on any ancestor, never reach for .empty from the
// outside — Ф6-6); shared with ErrorState so one container sizes both:
//   --state-min-height   default 120px (popup row height; the wide search-page
//                        column asks for more)
defineProps<{ text: string }>();
</script>

<style scoped lang="scss">
.empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    min-height: var(--state-min-height, 120px);
    padding: 24px;
    gap: 12px;
    color: var(--color-fg-muted);
}

.empty__icon {
    font-size: 30px;
    opacity: 0.5;
}

.empty__text {
    margin: 0;
    max-width: 260px;
    text-align: center;
}
</style>
