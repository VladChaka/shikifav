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

// Created on the first reported event, not on install: a profile that never
// reports anything (analytics switched off before the first popup) never gets
// an identifier at all.
async function ensureClientId(): Promise<string> {
    const stored = await getLocal('analyticsClientId');
    if (stored) {
        return stored;
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
        const { analytics } = await getSettings();
        if (!analytics) {
            await forgetAnalyticsClientId();
            return;
        }
        const clientId = await ensureClientId();
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
