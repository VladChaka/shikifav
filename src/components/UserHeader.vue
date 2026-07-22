<template>
    <header class="header">
        <img
            class="header__avatar"
            :src="user.avatarUrl || undefined"
            width="28"
            height="28"
            alt=""
        />
        <span class="header__nickname">{{ user.nickname }}</span>
        <!-- Reserved slot for the settings button; options page arrives in a later phase. -->
        <span
            class="header__action-slot"
            aria-hidden="true"
        ></span>
        <button
            class="header__logout"
            type="button"
            :title="i18n.header.logout"
            :aria-label="i18n.header.logout"
            :disabled="pending"
            @click="logout"
        >
            <svg
                viewBox="0 0 16 16"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
            >
                <path d="M6.5 3H4.2A1.2 1.2 0 0 0 3 4.2v7.6A1.2 1.2 0 0 0 4.2 13h2.3" />
                <path d="M10 5.5 12.5 8 10 10.5" />
                <path d="M12.5 8H6.5" />
            </svg>
        </button>
    </header>
</template>

<script setup lang="ts">
import type { User } from '@/src/lib/api/types';
import { useAuth } from '@/src/composables/use-auth';
import { i18n } from '@/src/lib/i18n';

defineProps<{ user: User }>();

const { pending, logout } = useAuth();
</script>

<style scoped lang="scss">
.header {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--color-border);
}

.header__avatar {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    /* Neutral circle while the image loads: no flash, no layout shift. */
    background: var(--color-surface);
    object-fit: cover;
}

.header__nickname {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
}

.header__action-slot {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
}

.header__logout {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--color-fg-muted);
    cursor: pointer;

    &:hover:not(:disabled) {
        background: var(--color-surface);
        color: var(--color-fg);
    }

    &:disabled {
        opacity: 0.5;
        cursor: default;
    }

    &:focus-visible {
        outline: 2px solid var(--color-accent);
        outline-offset: 1px;
    }
}
</style>
