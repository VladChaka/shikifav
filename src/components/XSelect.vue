<template>
    <div
        ref="rootEl"
        class="xselect-root"
        @focusout="onFocusout"
    >
        <button
            class="xselect"
            :class="{ 'xselect--open': open }"
            type="button"
            aria-haspopup="listbox"
            :aria-expanded="open"
            :aria-controls="open ? listboxId : undefined"
            :aria-activedescendant="activeDescendantId"
            :aria-label="ariaLabel"
            @click="toggle"
            @keydown="onKeydown"
        >
            <span
                v-if="statusDots"
                class="xselect__fdot"
                :class="`st-${modelValue}`"
                aria-hidden="true"
            ></span>
            <span class="xselect__val">{{ selectedLabel }}</span>
            <span
                class="xselect__chev"
                aria-hidden="true"
            >
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </span>
        </button>

        <!-- mousedown.prevent keeps focus on the trigger while clicking an
             option, so focusout does not close the menu before the click. -->
        <div
            v-if="open"
            :id="listboxId"
            class="xselect__menu"
            role="listbox"
            @mousedown.prevent
        >
            <div
                v-for="(option, index) in options"
                :id="optionId(index)"
                :key="option.value"
                class="xselect__opt"
                :class="[
                    statusDots ? `st-${option.value}` : null,
                    {
                        'xselect__opt--selected': option.value === modelValue,
                        'xselect__opt--active': index === activeIndex,
                        'xselect__opt--disabled': option.disabled,
                    },
                ]"
                role="option"
                :aria-selected="option.value === modelValue"
                :aria-disabled="option.disabled || undefined"
                @click="pick(option)"
                @mousemove="hoverOption(index, option)"
            >
                <span
                    v-if="statusDots"
                    class="xselect__dot"
                    aria-hidden="true"
                ></span>
                {{ option.label }}
                <span
                    v-if="option.value === modelValue"
                    class="xselect__check"
                    aria-hidden="true"
                    >✓</span
                >
            </div>
        </div>
    </div>
</template>

<script lang="ts">
// Module scope: a counter making listbox/option ids unique across instances.
let instanceCounter = 0;
</script>

<script setup lang="ts" generic="T extends string">
import { computed, onBeforeUnmount, ref, watch } from 'vue';

// Custom select replacing native <select> in the filters (components-select
// card): chevron rotation, accent focus ring when open, dropdown with a check
// on the selected option. With `statusDots` every option (and the closed
// trigger) shows the colored dot of its status — option values must then be
// UserRateStatus strings matching the global .st-* palette classes.
//
// Purely presentational v-model wrapper: same contract as the native select
// it replaces (update:modelValue fires only on an actual change).
export interface XSelectOption<V extends string> {
    value: V;
    label: string;
    disabled?: boolean;
}

const props = defineProps<{
    options: readonly XSelectOption<T>[];
    modelValue: T;
    statusDots?: boolean;
    ariaLabel?: string;
}>();

const emit = defineEmits<{
    'update:modelValue': [value: T];
}>();

const rootEl = ref<HTMLElement | null>(null);
const open = ref(false);
// Keyboard-highlighted option while the menu is open.
const activeIndex = ref(-1);

// Unique per-instance ids linking the trigger to its listbox and the
// highlighted option (aria-controls / aria-activedescendant).
const listboxId = `xselect-listbox-${++instanceCounter}`;

function optionId(index: number): string {
    return `${listboxId}-opt-${index}`;
}

const activeDescendantId = computed(() =>
    open.value && activeIndex.value >= 0 ? optionId(activeIndex.value) : undefined,
);

const selectedLabel = computed(
    () => props.options.find((o) => o.value === props.modelValue)?.label ?? '',
);

function toggle(): void {
    if (open.value) {
        close();
    } else {
        show();
    }
}

function show(): void {
    open.value = true;
    activeIndex.value = props.options.findIndex((o) => o.value === props.modelValue);
}

function close(): void {
    open.value = false;
}

function pick(option: XSelectOption<T>): void {
    if (option.disabled) {
        return;
    }
    close();
    if (option.value !== props.modelValue) {
        emit('update:modelValue', option.value);
    }
}

// Mouse hover mirrors the keyboard highlight; disabled options stay inert.
function hoverOption(index: number, option: XSelectOption<T>): void {
    if (!option.disabled) {
        activeIndex.value = index;
    }
}

// Move the highlight by `delta`, skipping disabled options.
function moveActive(delta: number): void {
    const total = props.options.length;
    let index = activeIndex.value;
    for (let step = 0; step < total; step += 1) {
        index = (index + delta + total) % total;
        if (!props.options[index]?.disabled) {
            activeIndex.value = index;
            return;
        }
    }
}

function onKeydown(event: KeyboardEvent): void {
    if (!open.value) {
        // Closed: arrows open the menu; Enter/Space fall through to click.
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            show();
        }
        return;
    }
    switch (event.key) {
        case 'Escape':
            event.preventDefault();
            close();
            break;
        case 'ArrowDown':
            event.preventDefault();
            moveActive(1);
            break;
        case 'ArrowUp':
            event.preventDefault();
            moveActive(-1);
            break;
        case 'Enter':
        case ' ': {
            // Intercepted before the button's native click would re-toggle.
            event.preventDefault();
            const option = props.options[activeIndex.value];
            if (option) {
                pick(option);
            } else {
                close();
            }
            break;
        }
    }
}

// Close on a click landing outside the component (the opening click is
// filtered out by the contains() check, so no open/close race).
function onDocumentClick(event: MouseEvent): void {
    if (rootEl.value && !rootEl.value.contains(event.target as Node)) {
        close();
    }
}

// Close when focus leaves the component (Tab away). Focus moving within the
// root (relatedTarget inside it) keeps the menu open; option clicks never get
// here because the menu swallows mousedown (see template).
function onFocusout(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (!next || !rootEl.value?.contains(next)) {
        close();
    }
}

watch(open, (isOpen) => {
    if (isOpen) {
        document.addEventListener('click', onDocumentClick);
    } else {
        document.removeEventListener('click', onDocumentClick);
    }
});

onBeforeUnmount(() => {
    document.removeEventListener('click', onDocumentClick);
});
</script>

<style scoped lang="scss">
.xselect-root {
    /* Anchor for the absolutely positioned dropdown. */
    position: relative;
    display: flex;
    min-width: 0;
}

.xselect {
    display: inline-flex;
    align-items: center;
    flex: 1;
    gap: 7px;
    min-width: 0;
    padding: 7px 9px 7px 11px;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    background: var(--color-bg);
    color: var(--color-fg);
    font: inherit;
    cursor: pointer;

    &:hover {
        border-color: var(--color-accent);
    }

    &:focus-visible {
        outline: none;
        border-color: var(--color-accent);
    }
}

.xselect--open {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 22%, transparent);
}

.xselect__val {
    flex: 1;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.xselect__chev {
    display: inline-flex;
    flex: 0 0 auto;
    color: var(--color-fg-muted);
    transition: transform 0.15s;

    svg {
        width: 14px;
        height: 14px;
    }
}

.xselect--open .xselect__chev {
    transform: rotate(180deg);
}

/* Closed-trigger dot of the current status (screens-my-lists card). */
.xselect__fdot {
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--sc);
}

.xselect__menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    left: 0;
    z-index: 10;
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: 9px;
    background: var(--color-bg);
    box-shadow: 0 10px 28px rgb(0 0 0 / 16%);
}

.xselect__opt {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 11px;
    cursor: pointer;
}

/* One hover style for mouse and keyboard: mousemove syncs activeIndex. */
.xselect__opt--active {
    background: var(--color-surface);
}

.xselect__opt--selected {
    font-weight: 600;
}

.xselect__opt--disabled {
    color: var(--color-fg-muted);
    cursor: default;
    opacity: 0.55;
}

.xselect__dot {
    flex: 0 0 auto;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--sc);
}

.xselect__check {
    margin-left: auto;
    color: var(--color-accent);
    font-size: 12px;
}
</style>
