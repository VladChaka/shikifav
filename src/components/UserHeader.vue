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
        <!-- Feather "settings": opens entrypoints/options in its own tab
             (options_ui.open_in_tab). Chrome closes the popup for us. -->
        <button
            class="header__btn"
            type="button"
            :title="i18n.header.settings"
            :aria-label="i18n.header.settings"
            @click="openOptions"
        >
            <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
            >
                <circle
                    cx="12"
                    cy="12"
                    r="3"
                />
                <path
                    d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H2a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 8a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H8a1.65 1.65 0 0 0 1-1.51V2a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V8a1.65 1.65 0 0 0 1.51 1H22a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
                />
            </svg>
        </button>
        <!-- Feather "log-out". -->
        <button
            class="header__btn"
            type="button"
            :title="i18n.header.logout"
            :aria-label="i18n.header.logout"
            :disabled="pending"
            @click="logout"
        >
            <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
            >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line
                    x1="21"
                    y1="12"
                    x2="9"
                    y2="12"
                />
            </svg>
        </button>
    </header>
</template>

<script setup lang="ts">
import { browser } from 'wxt/browser';
import type { User } from '@/src/lib/api/types';
import { useAuth } from '@/src/composables/use-auth';
import { i18n } from '@/src/lib/i18n';

// Shell header: avatar + nickname + icon actions.
//
// Public style handles (set them on any ancestor, never reach for .header from
// the outside — Ф6-6):
//   --header-pad            padding of the bar,           default 10px 12px
//   --header-border-bottom  its closing line,             default 1px solid var(--color-border)
defineProps<{ user: User }>();

const { pending, logout } = useAuth();

// The page is a full tab, so the same button works from the popup and from the
// search page; Chrome focuses an already open options tab instead of adding one.
function openOptions(): void {
    void browser.runtime.openOptionsPage();
}
</script>

<style scoped lang="scss">
.header {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 10px;

    /* Popup shell values by default; the search page puts the header inside a
       full-width bar that owns the line and widens the padding to its column. */
    padding: var(--header-pad, 10px 12px);
    border-bottom: var(--header-border-bottom, 1px solid var(--color-border));
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

/* Icon button per the screens-search card (.icobtn). */
.header__btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    padding: 5px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--color-fg-muted);

    svg {
        width: 17px;
        height: 17px;
    }

    &:hover:not(:disabled) {
        background: var(--color-surface);
        color: var(--color-fg);
    }

    /* Deeper dim than the foundation default: an icon-only button carries no
       label to read, so it has to fall further out of the eye. */
    &:disabled {
        opacity: 0.5;
    }

    /* Tighter ring: the two icons sit 10px from the nickname beside them. */
    &:focus-visible {
        outline-offset: 1px;
    }
}
</style>
