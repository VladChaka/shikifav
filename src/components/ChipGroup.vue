<template>
    <div
        class="chips"
        role="radiogroup"
        :aria-label="ariaLabel"
    >
        <button
            v-for="opt in options"
            :key="opt.value"
            class="chip"
            :class="[
                statusDots ? `st-${opt.value}` : 'chip--plain',
                { 'chip--active': opt.value === modelValue },
            ]"
            type="button"
            role="radio"
            :aria-checked="opt.value === modelValue"
            @click="pick(opt.value)"
        >
            <span
                v-if="statusDots"
                class="chip__dot"
                aria-hidden="true"
            ></span>
            {{ opt.label }}
        </button>
    </div>
</template>

<script setup lang="ts" generic="T extends string">
// Filter chip row (components-chips card): one tap per value instead of a
// dropdown (UX-1). Same v-model contract as XSelect — update:modelValue fires
// only on an actual change — so a filter can move between the two controls
// without touching its owner.
//
// With `statusDots` every chip gets the colored dot and the tint fill of its
// status: option values must then be UserRateStatus strings matching the
// global .st-* palette classes. Without it the chips are neutral (the type
// filter has no palette of its own).
export interface ChipOption<V extends string> {
    value: V;
    label: string;
}

const props = defineProps<{
    options: readonly ChipOption<T>[];
    modelValue: T;
    statusDots?: boolean;
    ariaLabel?: string;
}>();

const emit = defineEmits<{
    'update:modelValue': [value: T];
}>();

function pick(value: T): void {
    if (value !== props.modelValue) {
        emit('update:modelValue', value);
    }
}
</script>

<style scoped lang="scss">
.chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

.chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    background: transparent;
    color: var(--color-fg-muted);
    font: inherit;
    font-size: 12px;

    /* Constant weight: a bold active chip would shift the wrap point. */
    font-weight: 500;

    &:hover {
        border-color: color-mix(in srgb, var(--sc) 45%, transparent);
        color: var(--color-fg);
    }

    /* Tighter than the default ring of the foundation: a pill this small. */
    &:focus-visible {
        outline-offset: 1px;
    }
}

.chip__dot {
    flex: 0 0 auto;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--sc);
}

/* Active status chip mirrors the .badge look: tint fill, status-colored text. */
.chip--active {
    border-color: color-mix(in srgb, var(--sc) 32%, transparent);
    background: var(--sct);
    color: var(--sc);
}

/* Neutral chips (type filter): no --sc/--sct of their own, so both states are
   restated in neutral tokens. Accent fill is deliberately avoided — the light
   accent is the watching green and would read as an active status chip. */
.chip--plain {
    &:hover {
        border-color: color-mix(in srgb, var(--color-fg) 30%, transparent);
    }

    &.chip--active {
        border-color: color-mix(in srgb, var(--color-fg) 28%, transparent);
        background: var(--color-surface);
        color: var(--color-fg);
    }
}
</style>
