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
