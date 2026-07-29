import { httpsHref } from './external-url';

// Content of the «Поддержать» section of the options page (Ф8-1, Ф8-2).
//
// Deliberate exception to "every UI string lives in i18n.ts": the label and the
// hint of a *payment method* sit here, next to its url, because all three are
// one piece of content the owner edits in a single place — adding a payment
// link means editing one record, not one record plus one i18n key. Everything
// else stays in i18n.ts: the headings, the paragraph above the list, and the
// wording of the free ways to help, which never changes together with an
// address (hence a free action carries an id and a url, and nothing more).
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

// Free ways to help — they cost nothing to offer and work with an empty
// DONATION_METHODS. The id picks the wording out of i18n (options.help*), so a
// new action cannot be added without its two strings.
export type SupportActionId = 'review' | 'share' | 'bug';

export interface SupportAction {
    id: SupportActionId;
    // Optional: the extension is not in the store yet and the repository is not
    // published, so there is nowhere to point yet.
    url?: string;
    // An ask that is nothing but a link: without an address it sends nobody
    // anywhere, so the section leaves it out entirely instead of printing dead
    // text. Publishing then costs one url here and no change to the template.
    needsUrl?: boolean;
}

export const SUPPORT_ACTIONS: readonly SupportAction[] = [
    // Hidden until the listing exists: a review is left on the store page and
    // nowhere else.
    { id: 'review', needsUrl: true },
    // Happens away from the screen — it reads as an ask with no address at all.
    { id: 'share' },
    // Has no address either while the repository is unpublished, but the line
    // still says what a useful report contains; add `needsUrl` here too if it
    // should wait for an issue tracker.
    { id: 'bug' },
];

// The one way an entry becomes a live link. The url is hand-edited text, so it
// goes through the same https guard as a title link (src/lib/external-url.ts):
// everything else renders as plain text instead of an href.
export function supportHref(entry: DonationMethod | SupportAction): string | null {
    return httpsHref(entry.url);
}
