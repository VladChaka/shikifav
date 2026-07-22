import { ref } from 'vue';
import type { Ref } from 'vue';
import { sendMessage } from '../lib/messaging';
import type { ApiError, User } from '../lib/api/types';

// 'loading' covers the gap between popup mount and the auth.getState response,
// so the UI can render a skeleton instead of flashing the login screen.
export type AuthStatus = 'loading' | 'anonymous' | 'authorized';

export interface UseAuth {
    status: Ref<AuthStatus>;
    user: Ref<User | undefined>;
    error: Ref<ApiError | undefined>;
    pending: Ref<boolean>;
    refreshState: () => Promise<void>;
    login: () => Promise<void>;
    logout: () => Promise<void>;
}

// Module-level state: every component in the popup shares one auth session.
// The popup is short-lived, so the state is re-read on each open via the
// auto-initial refreshState() below.
const status = ref<AuthStatus>('loading');
const user = ref<User | undefined>(undefined);
const error = ref<ApiError | undefined>(undefined);
const pending = ref(false);

let initialized = false;

async function refreshState(): Promise<void> {
    const response = await sendMessage('auth.getState');
    if (response.ok) {
        status.value = response.data.status;
        user.value = response.data.user;
        error.value = undefined;
    } else {
        status.value = 'anonymous';
        user.value = undefined;
        error.value = response.error;
    }
}

async function login(): Promise<void> {
    if (pending.value) {
        return;
    }
    pending.value = true;
    error.value = undefined;
    try {
        const response = await sendMessage('auth.login');
        if (response.ok) {
            status.value = 'authorized';
            user.value = response.data.user;
        } else {
            error.value = response.error;
        }
    } finally {
        pending.value = false;
    }
}

async function logout(): Promise<void> {
    if (pending.value) {
        return;
    }
    pending.value = true;
    error.value = undefined;
    try {
        const response = await sendMessage('auth.logout');
        if (response.ok) {
            status.value = 'anonymous';
            user.value = undefined;
        } else {
            error.value = response.error;
        }
    } finally {
        pending.value = false;
    }
}

export function useAuth(): UseAuth {
    if (!initialized) {
        initialized = true;
        void refreshState();
    }
    return { status, user, error, pending, refreshState, login, logout };
}
