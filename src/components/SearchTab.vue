<template>
    <section class="search">
        <!-- docs/05 layout: [Аниме ▾] [поле поиска…] -->
        <div class="search__field">
            <XSelect
                class="search__type"
                :options="TYPE_OPTIONS"
                :model-value="searchType"
                :aria-label="i18n.lists.typeFilterLabel"
                @update:model-value="emit('update:searchType', $event)"
            />
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
import XSelect from '@/src/components/XSelect.vue';
import type { XSelectOption } from '@/src/components/XSelect.vue';
import type { SearchType } from '@/src/lib/api/types';
import { i18n } from '@/src/lib/i18n';

// Search screen frame: type selector + query field + scrollable results area.
// Both the query and the type are owned by the parent (v-model pair) — they
// plug into use-search's setQuery/setType.
defineProps<{
    modelValue: string;
    searchType: SearchType;
}>();

const emit = defineEmits<{
    'update:modelValue': [value: string];
    'update:searchType': [type: SearchType];
}>();

// Same labels as the "Мои списки" type filter (US-7).
const TYPE_OPTIONS: readonly XSelectOption<SearchType>[] = [
    { value: 'anime', label: i18n.lists.types.anime },
    { value: 'manga', label: i18n.lists.types.manga },
    { value: 'ranobe', label: i18n.lists.types.ranobe },
];

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

.search__field {
    display: flex;
    flex-shrink: 0;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--color-border);
}

.search__type {
    /* Sized by its widest label; the input takes the rest of the row. */
    flex-shrink: 0;
}

.search__input {
    flex: 1;
    min-width: 0;
    padding: 7px 10px;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: var(--color-bg);
    color: var(--color-fg);
    font: inherit;

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
