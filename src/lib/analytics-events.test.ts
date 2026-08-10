import { describe, expect, it } from 'vitest';
import { toMeasurementPayload } from './analytics-events';
import type { AnalyticsEvent } from './analytics-events';

// The payload is the wire format of a promise: PRIVACY.md says queries, titles
// and the account never leave the browser, and this is the last place that
// could break it. The closed union stops free text at compile time; these tests
// pin what actually goes into the body.
describe('toMeasurementPayload', () => {
    const event: AnalyticsEvent = { name: 'search_performed', params: { type: 'manga' } };

    it('carries the event name, its params and the build', () => {
        const payload = toMeasurementPayload('abc-123', event, '1.0.0');

        expect(payload.client_id).toBe('abc-123');
        expect(payload.events).toHaveLength(1);
        expect(payload.events[0].name).toBe('search_performed');
        expect(payload.events[0].params.type).toBe('manga');
        expect(payload.events[0].params.extension_version).toBe('1.0.0');
    });

    it('adds engagement time — GA4 drops events it reads as sessionless', () => {
        const payload = toMeasurementPayload('abc-123', event, '1.0.0');

        expect(payload.events[0].params.engagement_time_msec).toBe(1);
    });

    it('drops an absent optional param instead of sending it undefined', () => {
        // `status` is optional on api_failed: a network error has no HTTP code,
        // and `"status": undefined` would still occupy the key in the body.
        const payload = toMeasurementPayload(
            'abc-123',
            { name: 'api_failed', params: { kind: 'network', status: undefined } },
            '1.0.0',
        );

        expect(payload.events[0].params).not.toHaveProperty('status');
        expect(payload.events[0].params.kind).toBe('network');
    });

    it('sends a related screen open as its type and nothing else', () => {
        // The screen the count would give away: the body must hold the type and
        // the two params the payload adds itself, and no third fact.
        const payload = toMeasurementPayload(
            'abc-123',
            { name: 'related_opened', params: { type: 'Manga' } },
            '1.0.0',
        );

        expect(payload.events[0].name).toBe('related_opened');
        expect(payload.events[0].params.type).toBe('Manga');
        expect(Object.keys(payload.events[0].params).sort()).toEqual([
            'engagement_time_msec',
            'extension_version',
            'type',
        ]);
    });

    it('sends nothing beyond the declared params', () => {
        // The guard against a future event quietly gaining a field: whatever is
        // in the body is either a declared param or one of the two the payload
        // adds itself.
        const payload = toMeasurementPayload('abc-123', event, '1.0.0');

        expect(Object.keys(payload.events[0].params).sort()).toEqual([
            'engagement_time_msec',
            'extension_version',
            'type',
        ]);
    });
});
