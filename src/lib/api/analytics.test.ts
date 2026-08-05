import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { GA4_API_SECRET, GA4_MEASUREMENT_ID } from '../config';
import { getLocal, setLocal, setSettings } from '../storage';
import { trackEvent } from './analytics';
import type { AnalyticsEvent } from '../analytics-events';

// The behaviour worth testing here is what does NOT happen: no request when the
// user opted out, no leftover identifier after that, and no thrown error ever
// reaching the caller — analytics must not be able to break the feature it
// measures.

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
