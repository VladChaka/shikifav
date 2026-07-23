<template>
    <section class="search">
        <nav
            class="search__tabs"
            role="tablist"
        >
            <button
                class="search__tab search__tab--active"
                type="button"
                role="tab"
                aria-selected="true"
            >
                {{ i18n.tabs.search }}
            </button>
            <!-- "My lists" arrives in phase 3: aria-disabled instead of the
                 disabled attribute so the tooltip is guaranteed to show, and
                 the tab keeps its footprint (stable layout). -->
            <button
                class="search__tab search__tab--disabled"
                type="button"
                role="tab"
                aria-selected="false"
                aria-disabled="true"
                :title="i18n.tabs.inDevelopment"
            >
                {{ i18n.tabs.myLists }}
            </button>
        </nav>

        <div class="search__field">
            <input
                class="search__input"
                type="search"
                :placeholder="i18n.search.placeholder"
                :value="modelValue"
                autocomplete="off"
                spellcheck="false"
                @input="onInput"
            />
        </div>

        <div class="search__results">
            <slot />
        </div>
    </section>
</template>

<script setup lang="ts">
import { i18n } from '@/src/lib/i18n';

// Search screen frame: tabs + query field + scrollable results area.
// The query is owned by the parent (v-model) — useSearch plugs in at Ф2-6.
defineProps<{ modelValue: string }>();

const emit = defineEmits<{
    'update:modelValue': [value: string];
}>();

function onInput(event: Event): void {
    emit('update:modelValue', (event.target as HTMLInputElement).value);
}
</script>

<style scoped lang="scss">
.search {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
}

.search__tabs {
    display: flex;
    flex-shrink: 0;
    gap: 4px;
    padding: 8px 12px 0;
}

.search__tab {
    padding: 5px 12px;
    border: none;
    border-radius: 6px 6px 0 0;
    background: transparent;
    color: var(--color-fg-muted);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;

    &:focus-visible {
        outline: 2px solid var(--color-accent);
        outline-offset: -2px;
    }
}

.search__tab--active {
    background: var(--color-surface);
    color: var(--color-fg);
    cursor: default;
}

.search__tab--disabled {
    opacity: 0.55;
    cursor: default;
}

.search__field {
    flex-shrink: 0;
    padding: 8px 12px;
    border-bottom: 1px solid var(--color-border);
}

.search__input {
    width: 100%;
    padding: 6px 10px;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: var(--color-bg);
    color: var(--color-fg);
    font: inherit;
    font-size: 13.5px;

    &::placeholder {
        color: var(--color-fg-muted);
    }

    &:focus-visible {
        outline: none;
        border-color: var(--color-accent);
    }
}

.search__results {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: thin;
}
</style>
