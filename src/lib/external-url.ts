// The single https guard for anything that becomes a live link in the UI.
//
// Two callers with the same risk, one rule: a title's `url` comes from the API
// and survives in the session cache (Ф6-26), a donation link is edited by hand
// in src/lib/donations.ts. Both are values this code did not construct, so only
// an https link may reach an href — which rules out javascript:/data: URLs and
// any junk. Everything else renders as plain text; a link-less entry is a valid
// state, not an error.
export function httpsHref(url: string | null | undefined): string | null {
    return url?.startsWith('https://') ? url : null;
}
