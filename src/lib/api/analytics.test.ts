import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { GA4_API_SECRET, GA4_MEASUREMENT_ID } from '../config';
import { forgetAnalyticsClientId, getLocal, setLocal, setSettings } from '../storage';
import { trackEvent } from './analytics';
import type { AnalyticsEvent } from '../analytics-events';
import type { LocalState } from '../storage';

// The behaviour worth testing here is what does NOT happen: no request when the
// user opted out, no leftover identifier after that, nothing written or sent by
// an event that was already in flight when the switch went off, and no thrown
// error ever reaching the caller — analytics must not be able to break the
// feature it measures.

const fetchMock = vi.fn<typeof fetch>();
const event: AnalyticsEvent = { name: 'calendar_opened', params: {} };

// The suite runs against whatever .env the checkout has. With no GA4 property
// configured the client is a documented no-op, and asserting "a request went
// out" would be asserting the developer's env — so the request-shaped
// expectations are skipped there instead of failing.
const configured = GA4_MEASUREMENT_ID !== '' && GA4_API_SECRET !== '';
const whenConfigured = configured ? it : it.skip;

beforeEach(() => {
    fakeBrowser.reset();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    // fakeBrowser ships no manifest, and the client reads the extension version
    // out of it before sending. Without this the send throws on the way to
    // fetch, is swallowed by design, and the request-shaped expectations below
    // see no call at all — which is how they passed unnoticed for as long as
    // the checkout had no GA4 keys and skipped them.
    vi.spyOn(fakeBrowser.runtime, 'getManifest').mockReturnValue({
        version: '1.0.0',
    } as ReturnType<typeof fakeBrowser.runtime.getManifest>);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

// --- the opt-out races (Ф11 audit) ------------------------------------------

// Parks a trackEvent inside the storage read that carries `key`, so the user can
// switch statistics off at a point the event is already past its own consent
// check. Only the FIRST matching read is parked: the opt-out the test performs
// while parked reads storage too, and a second park would be a deadlock.
function parkOnRead(key: keyof LocalState): { hit: () => boolean; release: () => void } {
    const realGet = fakeBrowser.storage.local.get.bind(fakeBrowser.storage.local);
    let release: (() => void) | undefined;
    let hit = false;
    vi.spyOn(fakeBrowser.storage.local, 'get').mockImplementation((async (
        keys: string | string[],
    ) => {
        if (!hit && [keys].flat().includes(key)) {
            hit = true;
            await new Promise<void>((resolve) => {
                release = resolve;
            });
        }
        return realGet(keys);
    }) as never);
    return { hit: () => hit, release: () => release?.() };
}

// Every write of the identifier, including one taken back a moment later.
// «Нет идентификатора в профиле после» would also be true of a client that
// creates one and deletes it, and that difference is visible from outside: a new
// identifier is a new anonymous timeline in GA4, and a service worker killed
// between the write and the delete leaves it stored for good.
function watchIdWrites(): () => unknown[] {
    const realSet = fakeBrowser.storage.local.set.bind(fakeBrowser.storage.local);
    const writes: unknown[] = [];
    vi.spyOn(fakeBrowser.storage.local, 'set').mockImplementation((async (
        items: Record<string, unknown>,
    ) => {
        if ('analyticsClientId' in items) {
            writes.push(items.analyticsClientId);
        }
        return realSet(items);
    }) as never);
    return () => writes;
}

describe('trackEvent', () => {
    it('sends nothing when the user switched analytics off', async () => {
        await setSettings({ analytics: false });

        await trackEvent(event);

        expect(fetchMock).not.toHaveBeenCalled();
    });

    whenConfigured('drops the stored identifier on the first event after opting out', async () => {
        // Otherwise a later opt-in would silently resume the same anonymous
        // timeline the user had just ended. The options page deletes the id at
        // the moment of the click; this is the second line of defence, for an
        // id that outlived some other path. Only reachable in a build that has
        // a GA4 property — without one trackEvent returns before reading any
        // setting, and there is nothing to clean up.
        await setLocal('analyticsClientId', 'left-over-id');
        await setSettings({ analytics: false });

        await trackEvent(event);

        expect(await getLocal('analyticsClientId')).toBeUndefined();
    });

    it('never throws — a failing measurement must not fail the feature', async () => {
        await setSettings({ analytics: true });
        fetchMock.mockRejectedValue(new Error('offline'));

        await expect(trackEvent(event)).resolves.toBeUndefined();
    });

    whenConfigured('reuses one identifier across events', async () => {
        await setSettings({ analytics: true });

        await trackEvent(event);
        const first = await getLocal('analyticsClientId');
        await trackEvent(event);

        expect(first).toBeDefined();
        expect(await getLocal('analyticsClientId')).toBe(first);
    });

    whenConfigured('creates no identifier when the opt-out lands mid-event', async () => {
        // The first window from the audit: the event has already read
        // `analytics: true` and is on its way to the identifier when the user
        // clicks «Выключено». Whatever it does after that click, it may not
        // re-create what the click deleted — PRIVACY.md promises deletion, and an
        // identifier restored a millisecond later is the promise broken.
        await setSettings({ analytics: true });
        const idWrites = watchIdWrites();
        const parked = parkOnRead('analyticsClientId');

        const inFlight = trackEvent(event);
        await vi.waitFor(() => expect(parked.hit()).toBe(true));
        // Exactly the pair the options page fires on the click, in its order.
        await setSettings({ analytics: false });
        await forgetAnalyticsClientId();
        parked.release();
        await inFlight;

        expect(idWrites()).toEqual([]);
        expect(await getLocal('analyticsClientId')).toBeUndefined();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    whenConfigured('sends nothing under an identifier that outlived the opt-out', async () => {
        // The other half of the same click: the setting has landed and the delete
        // has not, so for a moment the identifier of the ended timeline is still
        // readable. An event that passed its consent check before the click must
        // neither send under it nor leave it behind.
        await setSettings({ analytics: true });
        await setLocal('analyticsClientId', 'from-the-ended-timeline');
        const parked = parkOnRead('analyticsClientId');

        const inFlight = trackEvent(event);
        await vi.waitFor(() => expect(parked.hit()).toBe(true));
        await setSettings({ analytics: false });
        parked.release();
        await inFlight;

        expect(fetchMock).not.toHaveBeenCalled();
        expect(await getLocal('analyticsClientId')).toBeUndefined();
    });

    whenConfigured('posts to google-analytics.com and nowhere near Shikimori', async () => {
        await setSettings({ analytics: true });

        await trackEvent(event);

        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toContain('https://www.google-analytics.com/mp/collect');
        expect(String(url)).not.toContain('shikimori');
        expect(init?.method).toBe('POST');
        // The token belongs to http.ts and must not travel with a measurement.
        expect(JSON.stringify(init?.headers ?? {})).not.toContain('Authorization');
    });
});
