<template>
    <main class="login">
        <img
            class="login__icon"
            src="/icon/128.png"
            width="64"
            height="64"
            alt=""
        />
        <p class="login__lead">{{ i18n.login.lead }}</p>
        <p
            v-if="error"
            class="login__error"
            role="alert"
        >
            {{ apiErrorMessage(error) }}
        </p>
        <button
            class="login__button"
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
.login {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 24px;
    gap: 16px;
    text-align: center;
}

.login__icon {
    /* Fixed box: no layout shift while the PNG loads. */
    width: 64px;
    height: 64px;
}

.login__lead {
    margin: 0;
    max-width: 260px;
    color: var(--color-fg-muted);
}

.login__error {
    margin: 0;
    max-width: 280px;
    font-size: 13px;
    color: var(--color-danger);
}

.login__button {
    padding: 8px 20px;
    border: none;
    border-radius: 6px;
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
</style>
