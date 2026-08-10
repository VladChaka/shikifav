import { httpsHref, mailtoHref } from './external-url';

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
// Either list may still go empty, and the two differ in what a missing address
// means. A free way to help is an ask, so it renders as plain text without one;
// a payment method is nothing BUT its address, so an entry whose url does not
// pass payHref() is dropped from the section instead of printing the name of a
// place nobody can pay through (Ф8-6).

export interface DonationMethod {
    id: string;
    label: string;
    // One line under the label: what exactly this method is (a card, a service,
    // a country restriction) — the reason the owner would keep several.
    hint: string;
    url: string;
}

// Https and nothing else — the rule is payHref() at the bottom of this file,
// not a promise the page is trusted to keep.
//
// The hint promises only what the page actually offers — the Boosty page of the
// project has no subscription tiers, only a one-off donation, so it says so
// instead of the usual «донат или подписка».
export const DONATION_METHODS: readonly DonationMethod[] = [
    {
        id: 'boosty',
        label: 'Boosty',
        hint: 'разовый донат на домен и почту проекта',
        url: 'https://boosty.to/chakalabs',
    },
];

// Free ways to help — they cost nothing to offer and work with an empty
// DONATION_METHODS. The id picks the wording out of i18n (options.help*), so a
// new action cannot be added without its two strings.
export type SupportActionId = 'review' | 'share' | 'bug' | 'telegram';

export interface SupportAction {
    id: SupportActionId;
    // Optional: an ask can exist before the place it points at does — see the
    // Telegram channel below.
    url?: string;
    // An ask that is nothing but a link: without an address it sends nobody
    // anywhere, so the section leaves it out entirely instead of printing dead
    // text. Filling the url in is then the whole job — no change to the
    // template, no v-if by id.
    needsUrl?: boolean;
}

// Order as in the design card screens/options.
export const SUPPORT_ACTIONS: readonly SupportAction[] = [
    // The extension is published, so the review has a page at last; the link
    // goes straight to the reviews tab of the listing. `needsUrl` stays for
    // what it guards: a review is left there and nowhere else, so an entry
    // without an address would send nobody anywhere.
    {
        id: 'review',
        url: 'https://chromewebstore.google.com/detail/shikifav/bpjembchapdbgncmacpkbepfjghjdkan/reviews',
        needsUrl: true,
    },
    // Happens away from the screen — it reads as an ask with no address at all.
    { id: 'share' },
    // Mail, not an issue tracker — and not for want of one: the repository is
    // public as of 2026-08-10. The ask is made inside the extension, to someone
    // who installed it from the store and has no reason to own a GitHub
    // account, so a letter stays the address that costs the reporter nothing.
    // The single caller that needs the mailto relaxation of supportHref().
    { id: 'bug', url: 'mailto:support@chakalabs.com' },
    // The channel exists since 2026-08-10. Public @name rather than an invite
    // link: an invite can be revoked, and a revoked one would keep sitting in
    // every installed copy until the next release. `needsUrl` still guards the
    // row — drop the address and it leaves the list instead of pointing at a
    // channel that is gone.
    { id: 'telegram', url: 'https://t.me/ChakaLabs', needsUrl: true },
];

// The two ways an entry becomes a live link — one per list, because the lists
// do not admit the same addresses. The url is hand-edited text either way, so
// it goes through the guards of src/lib/external-url.ts, and whatever they
// refuse renders as plain text instead of an href.

// The free asks: an https page, or one bare mailto: address for the report
// line. Mail is admitted here rather than inside httpsHref for the reason
// stated there — that guard also feeds <img src>.
export function supportHref(entry: DonationMethod | SupportAction): string | null {
    return httpsHref(entry.url) ?? mailtoHref(entry.url);
}

// The cash desks: https and nothing else, because there is no cash desk over
// mail. A named function here rather than httpsHref() at the call site, so the
// rule sits next to the records it constrains instead of in the page that
// happens to render them — the section then reads as two lists with two guards,
// and «касса только по https» stops being an invariant held up by a test.
export function payHref(method: DonationMethod): string | null {
    return httpsHref(method.url);
}
