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
// Exported so the parent (App, Ф3-4) can type its active-tab state. The
// vocabulary itself lives in storage.ts, which also validates what a profile
// wrote into `lastTab` / `startTab` (Ф7-9).
export type { PopupTab as TabId } from '@/src/lib/storage';
</script>

<script setup lang="ts">
import { i18n } from '@/src/lib/i18n';
import { POPUP_TABS } from '@/src/lib/storage';
import type { PopupTab } from '@/src/lib/storage';

// Top-level tab navigation "Поиск / Мои списки / Календарь" (docs/05, «Экран
// авторизован»). Presentational: the active tab is owned by the parent; this
// only reflects it and emits the requested change.
//
// Geometry is unchanged by the third tab: at flex:1 each label gets 126.7px
// minus 2x9 padding = 108.7px, while the widest («Мои списки») measures 86.9px
// at 13px/600 — no wrapping, no shortened labels (screens/calendar card).
//
// Props: active — currently selected tab.
// Emits: update:active(tab) — user picked another tab (v-model-friendly).
const props = defineProps<{ active: PopupTab }>();

const emit = defineEmits<{
    'update:active': [tab: PopupTab];
}>();

const TABS = POPUP_TABS;

// Indexed instead of branched, so a new tab in POPUP_TABS fails to compile
// here until it has a label.
const LABELS: Record<PopupTab, string> = {
    search: i18n.tabs.search,
    lists: i18n.tabs.myLists,
    calendar: i18n.tabs.calendar,
};

function label(tab: PopupTab): string {
    return LABELS[tab];
}

function select(tab: PopupTab): void {
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
