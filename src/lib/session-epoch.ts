// Which session the background is currently working for (Ф11-10, found by the
// review of the tick). A poll started under one account can only resolve minutes
// later — http.ts retries a 429 up to three times — and nothing can cancel it.
// If the session ends meanwhile, that abandoned tick would still write the
// snapshot and the badge of a session that no longer exists: the icon would keep
// a number, restoreBadge() would redraw it on every worker start, and the diff
// it computed against a snapshot read BEFORE the wipe would turn into
// notifications for the account that just left.
//
// So every write of the tick is fenced by this counter: the tick takes the epoch
// before the poll and drops everything it computed if the epoch moved while it
// was in the air.
//
// In-memory on purpose, not storage: it fences work of ONE service worker
// lifetime, and a tick cannot outlive the worker that started it. A restarted
// worker has no in-flight tick to fence.

let epoch = 0;

// Read at the start of a piece of background work that will write later.
export function sessionEpoch(): number {
    return epoch;
}

// Every way a session begins or ends: clearAuth() (logout, the domain switch, a
// refresh that lost the session) and a completed login (src/lib/api/auth.ts).
export function bumpSessionEpoch(): void {
    epoch += 1;
}

// False means "the session this work belongs to is over" — the caller must
// write nothing.
export function isSessionEpochCurrent(taken: number): boolean {
    return taken === epoch;
}
