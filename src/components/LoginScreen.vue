<template>
    <main class="login">
        <div
            class="login__logo"
            aria-hidden="true"
        >
            ★
        </div>
        <div class="login__app">{{ i18n.app.name }}</div>
        <p class="login__lead">{{ i18n.login.lead }}</p>
        <p
            v-if="error"
            class="login__error"
            role="alert"
        >
            {{ apiErrorMessage(error) }}
        </p>
        <!-- One button covers all cases; after a failed attempt it turns into
             the secondary "Повторить" (screens-login card). -->
        <button
            class="login__button"
            :class="{ 'login__button--retry': error && !pending }"
            type="button"
            :disabled="pending"
            @click="login"
        >
            {{ buttonLabel }}
        </button>
    </main>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useAuth } from '@/src/composables/use-auth';
import { apiErrorMessage, i18n } from '@/src/lib/i18n';

const { pending, error, login } = useAuth();

// One button covers all cases: sign in -> "signing in..." while pending,
// and "retry" after a failed attempt (docs/05-ui.md, unauthorized screen).
const buttonLabel = computed(() => {
    if (pending.value) {
        return i18n.login.signingIn;
    }
    return error.value ? i18n.login.retry : i18n.login.signIn;
});
</script>

<style scoped lang="scss">
/* screens-login card: logo tile, app name, lead, sign-in / retry. */
.login {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 32px;
    gap: 16px;
    text-align: center;
}

.login__logo {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 64px;
    height: 64px;
    border-radius: 16px;
    background: var(--color-surface);
    font-size: 30px;
}

.login__app {
    font-size: 18px;
    font-weight: 700;
}

.login__lead {
    margin: 0;
    max-width: 240px;
    color: var(--color-fg-muted);
}

.login__error {
    margin: 0;
    max-width: 280px;
    font-size: 13px;
    color: var(--color-danger);
}

.login__button {
    padding: 11px 20px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: var(--color-accent);
    color: var(--color-accent-fg);
    font: inherit;
    font-weight: 600;
    cursor: pointer;

    &:hover:not(:disabled) {
        background: var(--color-accent-hover);
    }

    &:disabled {
        opacity: 0.6;
        cursor: default;
    }

    &:focus-visible {
        outline: 2px solid var(--color-accent);
        outline-offset: 2px;
    }
}

/* Secondary variant after a failed attempt (screens-login, "Повторить"). */
.login__button--retry {
    padding: 9px 18px;
    border-color: var(--color-border);
    background: transparent;
    color: var(--color-fg);

    &:hover:not(:disabled) {
        background: var(--color-surface);
    }
}
</style>
