import type { ApiError } from './api/types';

// Every UI string lives in this single object (docs/05-ui.md, principle 4).
// No i18n libraries: the extension is single-user and Russian-only.
export const i18n = {
    app: {
        name: 'ShikiFav',
    },
    login: {
        lead: 'Войдите, чтобы управлять своими списками',
        signIn: 'Войти через Shikimori',
        signingIn: 'Входим…',
        retry: 'Повторить',
    },
    header: {
        logout: 'Выйти',
        settings: 'Настройки',
    },
    home: {
        placeholder: 'Поиск и списки появятся в следующих фазах',
    },
    errors: {
        network: 'Нет соединения с Shikimori. Проверьте интернет и повторите.',
        unauthorized: 'Сессия истекла. Войдите заново.',
        rateLimited: 'Слишком много запросов. Подождите немного и повторите.',
        api: 'Shikimori ответил ошибкой. Попробуйте ещё раз.',
        internal: 'Что-то пошло не так. Повторите попытку.',
    },
} as const;

// Maps a transport-level ApiError to a human-readable Russian message.
// The switch is exhaustive: adding a new ApiError kind breaks compilation here.
export function apiErrorMessage(error: ApiError): string {
    switch (error.kind) {
        case 'network':
            return i18n.errors.network;
        case 'unauthorized':
            return i18n.errors.unauthorized;
        case 'rate_limited':
            return i18n.errors.rateLimited;
        case 'api':
            return i18n.errors.api;
        case 'internal':
            return i18n.errors.internal;
    }
}
