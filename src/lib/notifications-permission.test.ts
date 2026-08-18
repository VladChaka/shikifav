import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import {
    hasNotificationsPermission,
    onNotificationsPermissionChanged,
    requestNotificationsPermission,
} from './notifications-permission';

// Ф11-11. fakeBrowser has no in-memory permissions implementation — every one
// of its methods throws «not implemented» — so the surface is mocked by hand
// here. That is also why every test below cares about the same thing: this
// module must survive an API that refuses to answer, because the state of one
// line of settings is not worth a page that stopped rendering.

const NOTIFICATIONS = { permissions: ['notifications'] };

type ChangeListener = (permissions: { permissions?: string[] }) => void;

// The listener bags fakeBrowser does not keep for us, one per direction.
let added: ChangeListener[] = [];
let removed: ChangeListener[] = [];

function mockPermissionEvents(): void {
    for (const [event, bag] of [
        [fakeBrowser.permissions.onAdded, () => added] as const,
        [fakeBrowser.permissions.onRemoved, () => removed] as const,
    ]) {
        vi.spyOn(event, 'addListener').mockImplementation((listener: unknown) => {
            bag().push(listener as ChangeListener);
        });
        vi.spyOn(event, 'removeListener').mockImplementation((listener: unknown) => {
            const kept = bag().filter((entry) => entry !== listener);
            bag().length = 0;
            bag().push(...kept);
        });
    }
}

function emit(bag: ChangeListener[], permissions: string[]): void {
    for (const listener of [...bag]) {
        listener({ permissions });
    }
}

beforeEach(() => {
    fakeBrowser.reset();
    added = [];
    removed = [];
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('hasNotificationsPermission', () => {
    it('asks Chrome about exactly the notifications permission', async () => {
        const contains = vi
            .spyOn(fakeBrowser.permissions, 'contains')
            .mockResolvedValue(true as never);

        await expect(hasNotificationsPermission()).resolves.toBe(true);
        expect(contains).toHaveBeenCalledWith(NOTIFICATIONS);
    });

    it('answers «нет» when Chrome does not hold it', async () => {
        vi.spyOn(fakeBrowser.permissions, 'contains').mockResolvedValue(false as never);
        await expect(hasNotificationsPermission()).resolves.toBe(false);
    });

    // A build whose manifest does not list the permission at all (until Ф11-10),
    // or an API that throws: «нет» is the honest answer and the block draws the
    // state that offers the button.
    it('answers «нет» instead of rejecting when the API refuses', async () => {
        await expect(hasNotificationsPermission()).resolves.toBe(false);
    });
});

describe('requestNotificationsPermission', () => {
    it('returns what the system dialog answered', async () => {
        const request = vi
            .spyOn(fakeBrowser.permissions, 'request')
            .mockResolvedValue(true as never);

        await expect(requestNotificationsPermission()).resolves.toBe(true);
        expect(request).toHaveBeenCalledWith(NOTIFICATIONS);
    });

    // The refusal the caller has to show a toast for: told apart from a granted
    // permission, never from a thrown error.
    it('reports a refusal as false', async () => {
        vi.spyOn(fakeBrowser.permissions, 'request').mockResolvedValue(false as never);
        await expect(requestNotificationsPermission()).resolves.toBe(false);
    });

    it('reports a throwing request as a refusal, not as a rejection', async () => {
        await expect(requestNotificationsPermission()).resolves.toBe(false);
    });
});

describe('onNotificationsPermissionChanged', () => {
    it('reports a revoked permission as «нет»', () => {
        mockPermissionEvents();
        const changed = vi.fn();
        onNotificationsPermissionChanged(changed);

        emit(removed, ['notifications']);

        expect(changed).toHaveBeenCalledExactlyOnceWith(false);
    });

    // Granted from chrome://extensions with the settings tab open: without this
    // half the block would keep offering the button for a permission the profile
    // already holds (ревью Ф11-10).
    it('reports a granted permission as «да»', () => {
        mockPermissionEvents();
        const changed = vi.fn();
        onNotificationsPermissionChanged(changed);

        emit(added, ['notifications']);

        expect(changed).toHaveBeenCalledExactlyOnceWith(true);
    });

    // Permissions are granted and revoked in bulk; a block that redrew on
    // somebody else's permission would flip its own line for no reason.
    it('ignores a change of another permission, in either direction', () => {
        mockPermissionEvents();
        const changed = vi.fn();
        onNotificationsPermissionChanged(changed);

        emit(removed, ['tabs']);
        emit(added, ['tabs']);
        emit(removed, []);

        expect(changed).not.toHaveBeenCalled();
    });

    it('stops firing on both events after the returned unsubscribe', () => {
        mockPermissionEvents();
        const changed = vi.fn();
        const stop = onNotificationsPermissionChanged(changed);

        stop();
        emit(removed, ['notifications']);
        emit(added, ['notifications']);

        expect(changed).not.toHaveBeenCalled();
        expect(added).toEqual([]);
        expect(removed).toEqual([]);
    });

    // The subscription is the one call that happens at mount: if it throws, the
    // settings page must still mount, and its unsubscribe must still be callable
    // from onUnmounted.
    it('survives an API that cannot subscribe, and hands back a safe unsubscribe', () => {
        const stop = onNotificationsPermissionChanged(() => {});
        expect(() => stop()).not.toThrow();
    });
});
