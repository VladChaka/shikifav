<template>
    <section class="search">
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

.search__field {
    flex-shrink: 0;
    padding: 10px 12px;
    border-bottom: 1px solid var(--color-border);
}

.search__input {
    width: 100%;
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
