import type { AnalyticsEvent } from './analytics-events';
import { sendMessage } from './messaging';

// Reporting from the UI, for the events background cannot see by itself: which
// tab the popup opened on, and which setting was changed.
//
// Fire and forget, and the `void` is the point. Nothing on screen may wait for
// a measurement — awaiting this in a click handler would put a round trip
// between the click and the repaint. A failure is already swallowed twice:
// sendMessage answers with an error object instead of throwing, and trackEvent
// on the other side never fails.
export function reportEvent(event: AnalyticsEvent): void {
    void sendMessage('analytics.track', event);
}
