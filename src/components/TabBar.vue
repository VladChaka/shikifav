<template>
    <nav
        class="tabs"
        role="tablist"
    >
        <button
            v-for="tab in TABS"
            :key="tab"
            class="tabs__tab"
            :class="{ 'tabs__tab--active': tab === active }"
            type="button"
            role="tab"
            :aria-selected="tab === active"
            @click="select(tab)"
        >
            {{ label(tab) }}
        </button>
    </nav>
</template>

<script lang="ts">
// Exported so the parent (App, Ф3-4) can type its active-tab state.
export type TabId = 'search' | 'lists';
</script>

<script setup lang="ts">
import { i18n } from '@/src/lib/i18n';

// Top-level tab navigation "Поиск / Мои списки" (docs/05, «Экран авторизован»).
// Presentational: the active tab is owned by the parent; this only reflects it
// and emits the requested change (markup moved out of SearchTab).
//
// Props: active — currently selected tab.
// Emits: update:active(tab) — user picked another tab (v-model-friendly).
const props = defineProps<{ active: TabId }>();

const emit = defineEmits<{
    'update:active': [tab: TabId];
}>();

const TABS: readonly TabId[] = ['search', 'lists'];

function label(tab: TabId): string {
    return tab === 'search' ? i18n.tabs.search : i18n.tabs.myLists;
}

function select(tab: TabId): void {
    if (tab !== props.active) {
        emit('update:active', tab);
    }
}
</script>

<style scoped lang="scss">
.tabs {
    display: flex;
    flex-shrink: 0;
    gap: 4px;
    padding: 8px 12px 0;
}

.tabs__tab {
    padding: 5px 12px;
    border: none;
    border-radius: 6px 6px 0 0;
    background: transparent;
    color: var(--color-fg-muted);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;

    &:hover:not(.tabs__tab--active) {
        color: var(--color-fg);
    }

    &:focus-visible {
        outline: 2px solid var(--color-accent);
        outline-offset: -2px;
    }
}

.tabs__tab--active {
    background: var(--color-surface);
    color: var(--color-fg);
    cursor: default;
}
</style>
