import { httpsHref } from './external-url';

// Content of the «Поддержать» section of the options page (Ф8-1).
//
// Deliberate exception to "every UI string lives in i18n.ts": the label and the
// hint of a way to support the project sit here, next to its url, because all
// three are one piece of content the owner edits in a single place — adding a
// payment link means editing one record, not one record plus one i18n key. The
// static text of the section (its heading, the paragraph above the list, the
// «Как ещё помочь» subheading) stays in i18n.ts, where it belongs.
//
// Both lists may be empty, and an entry without a url is a valid state: no
// payment method is set up yet, and the repository is not published, so its
// address is unknown. The UI renders a link-less entry as plain text.

export interface DonationMethod {
    id: string;
    label: string;
    // One line under the label: what exactly this method is (a card, a service,
    // a country restriction) — the reason the owner would keep several.
    hint: string;
    url: string;
}

// Empty on purpose: the owner has no place to accept anything yet. Filling this
// array is the whole job of adding donations — the section renders itself from
// it and hides the block while it is empty.
export const DONATION_METHODS: readonly DonationMethod[] = [
    // {
    //     id: 'boosty',
    //     label: 'Boosty',
    //     hint: 'Разовый донат или подписка, карты РФ',
    //     url: 'https://boosty.to/<name>',
    // },
];

// Free ways to help, always shown — they cost nothing to offer and work with an
// empty DONATION_METHODS.
export interface SupportAction {
    id: string;
    label: string;
    hint: string;
    // Optional: the extension is not in the store yet and the repository is not
    // published, so an action with nowhere to point still reads as an ask.
    url?: string;
}

export const SUPPORT_ACTIONS: readonly SupportAction[] = [
    {
        id: 'review',
        label: 'Оценить в Chrome Web Store',
        hint: 'Оценка и пара слов в отзыве — расширение проще найти тем, кому оно нужно.',
    },
    {
        id: 'share',
        label: 'Рассказать знакомым',
        hint: 'Тем, кто ведёт списки на Shikimori и открывает сайт по десять раз в день.',
    },
    {
        id: 'bug',
        label: 'Сообщить об ошибке',
        hint: 'Что пошло не так и на каком шаге — этого хватает, чтобы починить.',
    },
];

// The one way an entry becomes a live link. The url is hand-edited text, so it
// goes through the same https guard as a title link (src/lib/external-url.ts):
// everything else renders as plain text instead of an href.
export function supportHref(entry: DonationMethod | SupportAction): string | null {
    return httpsHref(entry.url);
}
