<template>
    <section
        class="search"
        :class="`search--${variant}`"
    >
        <!-- docs/05 layout: полноширинное поле поиска, под ним чипы типа -->
        <div class="search__field">
            <div class="search__box">
                <input
                    ref="inputEl"
                    class="search__input"
                    type="search"
                    :placeholder="i18n.search.placeholder"
                    :value="modelValue"
                    autocomplete="off"
                    spellcheck="false"
                    @input="onInput"
                />
                <button
                    v-if="modelValue !== ''"
                    class="search__clear"
                    type="button"
                    :aria-label="i18n.search.clear"
                    @click="clearQuery"
                >
                    <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                    >
                        <line
                            x1="6"
                            y1="6"
                            x2="18"
                            y2="18"
                        />
                        <line
                            x1="6"
                            y1="18"
                            x2="18"
                            y2="6"
                        />
                    </svg>
                </button>
            </div>
            <ChipGroup
                :options="TYPE_OPTIONS"
                :model-value="searchType"
                :aria-label="i18n.search.typeFilterLabel"
                @update:model-value="emit('update:searchType', $event)"
            />
        </div>

        <div class="search__results">
            <slot />
        </div>
    </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import ChipGroup from '@/src/components/ChipGroup.vue';
import type { ChipOption } from '@/src/components/ChipGroup.vue';
import type { SearchType } from '@/src/lib/api/types';
import { i18n } from '@/src/lib/i18n';

// Search screen frame: query field + type chip row + results area.
// Both the query and the type are owned by the parent (v-model pair) — they
// plug into use-search's setQuery/setType.
//
// Public layout handle (Ф6-6 — the owners set the variant instead of reaching
// for .search__field / .search__results from the outside):
//   variant='popup' (default) — fixed-size window: the results area is the
//                               scroll container, the field sits in a framed
//                               row of the shell;
//   variant='page'            — full tab: the document scrolls (an inner
//                               scroller would clip the status menu of the
//                               bottom cards), and the field follows the
//                               column rhythm instead of the shell frame.
withDefaults(
    defineProps<{
        modelValue: string;
        searchType: SearchType;
        variant?: 'popup' | 'page';
    }>(),
    { variant: 'popup' },
);

const emit = defineEmits<{
    'update:modelValue': [value: string];
    'update:searchType': [type: SearchType];
}>();

// Same labels as the "Мои списки" type filter (US-7).
const TYPE_OPTIONS: readonly ChipOption<SearchType>[] = [
    { value: 'anime', label: i18n.lists.types.anime },
    { value: 'manga', label: i18n.lists.types.manga },
    { value: 'ranobe', label: i18n.lists.types.ranobe },
];

function onInput(event: Event): void {
    emit('update:modelValue', (event.target as HTMLInputElement).value);
}

const inputEl = ref<HTMLInputElement | null>(null);

// Custom clear button (UX-1): the native webkit cancel button is hidden in
// CSS (it ignores the theme). Clearing keeps focus in the field.
function clearQuery(): void {
    emit('update:modelValue', '');
    inputEl.value?.focus();
}

// The input ref stays private; the search page (opened without ?q=) needs a way
// to put the caret in the field, so only this method is public.
function focus(): void {
    inputEl.value?.focus();
}

defineExpose({ focus });
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
    flex-direction: column;
    flex-shrink: 0;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--color-border);
}

/* On the page the divider under the field is the results box border, and the
   horizontal padding belongs to the content column. */
.search--page .search__field {
    padding: 0 0 14px;
    border-bottom: 0;
}

.search__box {
    /* Anchor for the absolutely positioned clear button. */
    position: relative;
    display: flex;
    flex: 1;
    min-width: 0;
}

.search__input {
    flex: 1;
    min-width: 0;

    /* Right padding reserves room for the clear button. */
    padding: 7px 30px 7px 10px;
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

    /* The native (blue, unthemed) cancel button is replaced by ours. */
    &::-webkit-search-cancel-button {
        -webkit-appearance: none;
        appearance: none;
    }
}

.search__clear {
    position: absolute;
    top: 50%;
    right: 5px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--color-fg-muted);
    cursor: pointer;
    transform: translateY(-50%);

    svg {
        width: 14px;
        height: 14px;
    }

    &:hover {
        color: var(--color-fg);
    }

    &:focus-visible {
        outline: 2px solid var(--color-accent);
        outline-offset: -1px;
        color: var(--color-fg);
    }
}

.search__results {
    flex: 1;
    min-height: 0;

    /* Popup: this is the scroll container of the fixed-size window. */
    overflow-y: auto;
    scrollbar-width: thin;
}

/* Page: the whole document scrolls instead — an inner scroller would clip the
   status menu of the bottom cards. */
.search--page .search__results {
    overflow: visible;
}
</style>
