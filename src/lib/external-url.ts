import { ORIGINS } from './config';

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

// Ф11-16: the same value, judged by a stricter rule, and on purpose NOT a
// tightening of httpsHref. That guard has three callers — title links, posters,
// donation links — and every one of them either renders an <img src> or an <a>
// the user reads and decides to follow; narrowing the rule for all of them is a
// separate decision, not a side effect of this one.
//
// What is different here: a click on a notification is opened BY US, in a new
// tab, from a message the user saw without an address in it. The address itself
// comes from the API answer (AiredPollItem.url), so the only thing that keeps a
// substituted answer from choosing where that tab lands is this check against
// the two origins the extension knows (src/lib/config.ts).
//
// Parsed rather than matched by prefix: `https://shikimori.io.evil.example/x`
// passes any startsWith, and only a parser tells the host from the path. The
// normalised href is what comes back, not the raw string — the parser is
// tolerant of tabs and newlines inside a url and strips them, and the value
// handed to tabs.create must be the one that was judged. Credentials are refused
// outright: `https://shikimori.io@evil.example` parses with a foreign host, and
// even on our own host a url carrying a login is not an address we produce.
export function shikimoriHref(url: string | null | undefined): string | null {
    if (typeof url !== 'string') {
        return null;
    }
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    if (parsed.username !== '' || parsed.password !== '') {
        return null;
    }
    // Origin covers the scheme too: every entry of ORIGINS is https.
    return (ORIGINS as readonly string[]).includes(parsed.origin) ? parsed.href : null;
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
