<template>
    <div class="empty">
        <p class="empty__text">{{ text }}</p>
    </div>
</template>

<script setup lang="ts">
// Neutral empty state: "nothing found" or the empty-query hint (docs/05).
defineProps<{ text: string }>();
</script>

<style scoped lang="scss">
.empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    min-height: 120px;
    padding: 16px;
}

.empty__text {
    margin: 0;
    max-width: 260px;
    color: var(--color-fg-muted);
    text-align: center;
}
</style>
