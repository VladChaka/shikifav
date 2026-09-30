import { browser } from 'wxt/browser';
import { toMeasurementPayload } from '../analytics-events';
import type { AnalyticsEvent } from '../analytics-events';
import { GA4_API_SECRET, GA4_ENDPOINT, GA4_MEASUREMENT_ID } from '../config';
import { forgetAnalyticsClientId, getLocal, getSettings, setLocal } from '../storage';

// Anonymous usage statistics, GA4 Measurement Protocol (фаза 10).
//
// Deliberately NOT built on http.ts. That client exists for Shikimori: it
// attaches the Bearer token, sets the User-Agent with the OAuth app name and
// queues everything through the 4 rps / 80 rpm limiter (CLAUDE.md rules 1–3).
// None of that may reach Google — a token least of all — and Shikimori's rate
// budget must not be spent on measurement. So this is a plain fetch, and the
// only thing the two share is that both live in background (rule 1).
//
// Three states, and two of them are silent:
//   - no property configured (empty env)     -> no-op, nothing is ever sent;
//   - user switched analytics off            -> no-op, and the id is dropped;
//   - otherwise                              -> one request per event.
//
// One request per event and no batching on purpose: an MV3 service worker is
// terminated a few seconds after it goes idle, so a buffer waiting for a flush
// is a buffer that mostly gets discarded. Events are rare (a handful per popup
// session), and a lost measurement is worth less than the complexity.

function isConfigured(): boolean {
    return GA4_MEASUREMENT_ID !== '' && GA4_API_SECRET !== '';
}

// Consent, read fresh every time (Ф11 audit). Sending one event is a chain of
// awaits, the setting lives in shared storage, and the user can switch
// statistics off in another tab during any link of that chain. So the answer is
// never carried across an await: it is asked again immediately before each of
// the two steps that cannot be taken back — writing the identifier, and sending
// the request. PRIVACY.md promises the identifier is deleted on opt-out, and an
// event that started a moment earlier must not put it back.
async function consented(): Promise<boolean> {
    return (await getSettings()).analytics;
}

// Created on the first reported event, not on install: a profile that never
// reports anything (analytics switched off before the first popup) never gets
// an identifier at all.
//
// undefined = there is no identifier and this call is not allowed to make one,
// because consent is gone by the time it would be written.
async function ensureClientId(): Promise<string | undefined> {
    const stored = await getLocal('analyticsClientId');
    if (stored) {
        return stored;
    }
    // The write is the reason for the second read: the options page stores the
    // switch BEFORE deleting the identifier, so once the switch says "off" no
    // event may create one — otherwise the delete would be undone by whatever
    // was already in flight when the user clicked.
    if (!(await consented())) {
        return undefined;
    }
    const created = crypto.randomUUID();
    await setLocal('analyticsClientId', created);
    return created;
}

export async function trackEvent(event: AnalyticsEvent): Promise<void> {
    if (!isConfigured()) {
        return;
    }
    try {
        if (!(await consented())) {
            await forgetAnalyticsClientId();
            return;
        }
        const clientId = await ensureClientId();
        if (clientId === undefined) {
            return;
        }
        // The last gate before the wire, and the one that also cleans up. An
        // identifier that already existed comes back from ensureClientId without
        // any consent check, so without this an event that passed the check
        // above and only got here after the opt-out would still POST — under the
        // identifier of the timeline the user had just ended. The delete covers
        // the narrow case of an opt-out landing while the identifier was being
        // written.
        if (!(await consented())) {
            await forgetAnalyticsClientId();
            return;
        }
        const version = browser.runtime.getManifest().version;
        const url =
            `${GA4_ENDPOINT}?measurement_id=${encodeURIComponent(GA4_MEASUREMENT_ID)}` +
            `&api_secret=${encodeURIComponent(GA4_API_SECRET)}`;
        await fetch(url, {
            method: 'POST',
            body: JSON.stringify(toMeasurementPayload(clientId, event, version)),
        });
    } catch (e) {
        // Measurement never breaks the feature it measures, and never reports
        // its own failure anywhere but the debug console. Only the kind of the
        // error is logged: the url carries the api_secret (docs/02, logging).
        console.debug('[analytics] send failed:', e instanceof Error ? e.name : typeof e);
    }
}
