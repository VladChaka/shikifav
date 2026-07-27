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
    border-bottom: 1px solid var(--color-border);
}

.tabs__tab {
    flex: 1;
    padding: 9px;
    border: none;
    background: transparent;
    color: var(--color-fg-muted);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    text-align: center;

    &:hover:not(.tabs__tab--active) {
        color: var(--color-fg);
    }

    /* Inset ring: the tabs are full-bleed, an outset one would be cut off by
       the popup edge. */
    &:focus-visible {
        outline-offset: -2px;
    }
}

.tabs__tab--active {
    color: var(--color-fg);
    box-shadow: inset 0 -2px 0 var(--color-accent);
    cursor: default;
}
</style>
