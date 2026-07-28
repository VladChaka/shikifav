// The one place where a title record's `url` is allowed to become a live link
// (Ф6-26). The value is server data that also survives in the session cache, so
// it is treated as untrusted input: only an https link may reach an href, which
// rules out javascript:/data: URLs and any junk. Everything else renders as
// plain text — a title without a link is a valid state (docs/02: records cached
// by builds older than Ф6-26 carry no url at all).
export function titleHref(url: string | null | undefined): string | null {
    return url?.startsWith('https://') ? url : null;
}
