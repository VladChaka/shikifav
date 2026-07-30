import type { AnalyticsEvent } from './analytics-events';
import type { MessageMap, MessageType } from './messaging';

// Which messages are worth a measurement, decided in one place.
//
// The alternative was a trackEvent() call inside every composable. This is
// cheaper and safer: background already sees every action the UI takes, so
// there is exactly one file to audit when the question is "what does this
// extension report?" — and a new feature cannot start reporting by accident,
// because it has to be added here on purpose.
//
// What it cannot see: things that never reach background. The opened tab and a
// changed setting are reported by the UI itself through analytics-report.ts,
// and failures are reported by the wrapper in background that catches them.

export function eventForMessage(type: MessageType, payload: unknown): AnalyticsEvent | null {
    switch (type) {
        case 'search.titles': {
            // Only the catalogue, never the query — the payload also holds the
            // text the user typed, and it stops here.
            const { type: searchType } = payload as MessageMap['search.titles']['payload'];
            return { name: 'search_performed', params: { type: searchType } };
        }
        case 'rates.create': {
            const { targetType, status } = payload as MessageMap['rates.create']['payload'];
            return { name: 'rate_created', params: { type: targetType, status } };
        }
        case 'rates.update': {
            const { patch } = payload as MessageMap['rates.update']['payload'];
            // One patch changes one control; the first key present is the one
            // the user actually moved.
            if (patch.status !== undefined) {
                return { name: 'rate_updated', params: { field: 'status' } };
            }
            if (patch.score !== undefined) {
                return { name: 'rate_updated', params: { field: 'score' } };
            }
            if (patch.episodes !== undefined || patch.chapters !== undefined) {
                // Typed in by hand: the «+1» button goes through rates.increment.
                return { name: 'episode_incremented', params: { by: 'typed' } };
            }
            return null;
        }
        case 'rates.increment':
            return { name: 'episode_incremented', params: { by: 'step' } };
        case 'rates.delete':
            // Only that a removal happened: which title it was is exactly the
            // kind of thing that stays in the browser.
            return { name: 'rate_deleted', params: {} };
        case 'calendar.list':
            return { name: 'calendar_opened', params: {} };
        default:
            // Everything else is either infrastructure (ping, posters, auth
            // state) or carries something personal by nature. Silence is the
            // default on purpose: an unlisted message reports nothing.
            return null;
    }
}
