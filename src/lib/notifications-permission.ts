import { browser } from 'wxt/browser';
import type { Browser } from 'wxt/browser';

// The optional `notifications` permission (US-12, Ф11-11) — the only module
// that talks to browser.permissions. The settings page owns the ask; the
// background reads the same answer before it shows anything (Ф11-10).
//
// The permission is declared optional and asked for by a button (решение 2 of
// phase 11): a permission with a warning, added to an update, disables the
// extension for everyone who already has it until they accept.
//
// Everything here is total: a missing or refused API costs the state of one
// line of settings, never the page. `contains` answering «нет» is exactly the
// state the block would draw anyway.

// Rebuilt per call on purpose: Chrome mutates nothing here, but a shared
// literal typed as readonly would not satisfy the API signature.
function descriptor(): Browser.permissions.Permissions {
    return { permissions: ['notifications'] };
}

// True only when Chrome currently holds the permission. Called at mount to tell
// state 1 («разрешены») from state 2 («разрешения нет»).
export async function hasNotificationsPermission(): Promise<boolean> {
    try {
        return await browser.permissions.contains(descriptor());
    } catch {
        return false;
    }
}

// MUST be called straight from a click handler: Chrome refuses a request made
// after an await, and the refusal is indistinguishable from the user saying no.
// Returns what the system dialog answered — `false` also means «отказали», and
// the caller shows a toast for it (a silent refusal reads as a broken button).
export async function requestNotificationsPermission(): Promise<boolean> {
    try {
        return await browser.permissions.request(descriptor());
    } catch {
        return false;
    }
}

// Granting or revoking the permission from chrome://extensions with the settings
// tab open. BOTH directions matter and for the same reason: without onRemoved an
// open page would keep claiming «Уведомления разрешены» forever, and without
// onAdded it would keep offering the button for a permission the profile already
// has. The listener is told which way it went, so one subscription covers the
// whole line. Returns an unsubscribe for onUnmounted.
export function onNotificationsPermissionChanged(listener: (granted: boolean) => void): () => void {
    // The event carries what CHANGED, and permissions are granted and revoked in
    // bulk; anything without ours in it leaves this block alone.
    const changed =
        (granted: boolean) =>
        (permissions: { permissions?: string[] }): void => {
            if (permissions.permissions?.includes('notifications')) {
                listener(granted);
            }
        };
    const onAdded = changed(true);
    const onRemoved = changed(false);
    try {
        browser.permissions.onAdded.addListener(onAdded);
        browser.permissions.onRemoved.addListener(onRemoved);
    } catch {
        // One of the two may have subscribed before the other threw; the
        // unsubscribe below is total, so it is handed back either way.
        return () => stop(onAdded, onRemoved);
    }
    return () => stop(onAdded, onRemoved);
}

function stop(
    onAdded: (permissions: { permissions?: string[] }) => void,
    onRemoved: (permissions: { permissions?: string[] }) => void,
): void {
    try {
        browser.permissions.onAdded.removeListener(onAdded);
    } catch {
        // Nothing to undo: the page is going away either way.
    }
    try {
        browser.permissions.onRemoved.removeListener(onRemoved);
    } catch {
        // Same.
    }
}
