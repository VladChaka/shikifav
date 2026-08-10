// The single https guard for anything that becomes an address in the UI.
//
// Three kinds of caller, same risk and one rule: a title's `url` comes from the
// API and survives in the session cache (Ф6-26), a donation link is edited by
// hand in src/lib/donations.ts, poster and avatar urls arrive with an API answer
// and end up in an <img src>. None of them is a value this code constructed, so
// only an https address may reach an href or a src — which rules out
// javascript:/data: URLs and any junk. A refused address falls back to a state
// that already exists and is valid, not to an error: a link-less entry renders
// as plain text, a poster-less card shows the local fallback image.
export function httpsHref(url: string | null | undefined): string | null {
    return url?.startsWith('https://') ? url : null;
}

// The same rule asked as a question. A caller that already holds a guarded
// address and only needs to know whether it opens a page in the browser — new
// tab, `rel`, the «external» glyph — asks here instead of testing the prefix a
// second time: which schemes exist is this file's business, and `https://`
// stays one literal in one place.
export function isHttpsUrl(url: string | null | undefined): boolean {
    return httpsHref(url) !== null;
}

// The mail counterpart, on purpose a second function instead of a second scheme
// allowed inside httpsHref. That guard also feeds the <img src> of posters and
// avatars, where a mailto: address means nothing: widening it would hand the
// relaxation to every caller, including the ones that never asked for it. A
// caller that may legitimately point at mail says so by calling this one.
//
// What passes is one bare address and nothing else. A mailto: url can carry the
// letter itself in its query — `?subject=`, `?body=`, `?cc=`, `?bcc=` — so `?`
// and `&` are refused: an address is an invitation to write, a prefilled letter
// is a message composed for the user by whoever supplied the value, and a
// hidden `bcc` sends a copy of it somewhere else. `,` and `;` are how a list of
// recipients is written, and one address means one recipient. `:` and `/` have
// no place inside an address, and whitespace is how a header would be smuggled
// in behind a line break. `%` is refused because it carries all of the above
// past the rest of this pattern: percent-encoding is decoded by the mail client
// after the match, so `%2C` is that second recipient and `%0D%0A` is that line
// break — and no address of this project needs a percent sign. The prefix is
// matched case-sensitively for the same reason as in httpsHref: a value that
// has to be normalised before it can be judged is not a value worth trusting.
// One pattern over the whole string — no new URL(), which would parse and
// thereby accept far more than this.
const MAILTO_ADDRESS = /^mailto:[^\s,;:?&/@%]+@[^\s,;:?&/@%]+\.[A-Za-z]{2,}$/;

export function mailtoHref(url: string | null | undefined): string | null {
    return url && MAILTO_ADDRESS.test(url) ? url : null;
}
