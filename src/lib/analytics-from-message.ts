import type { AnalyticsEvent } from './analytics-events';
import type { ApiError } from './api/types';
import type { MessageMap, MessageType } from './messaging';

// Which messages — and which of their failures — are worth a measurement,
// decided in one place.
//
// The alternative was a trackEvent() call inside every composable. This is
// cheaper and safer: background already sees every action the UI takes, so
// there is exactly one file to audit when the question is "what does this
// extension report?" — and a new feature cannot start reporting by accident,
// because it has to be added here on purpose.
//
// What it cannot see: things that never reach background. The opened tab and a
// changed setting are reported by the UI itself through analytics-report.ts;
// failures come back here through eventForError(), called by the wrapper in
// background that catches them.

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
        case 'titles.related': {
            // Only the type of the host title: `targetId` names one title and
            // stops here, exactly like the search query above. The answer is not
            // looked at either — its length would identify the title on its own
            // (see the event declaration). Counted per LOAD, not per open: the
            // screen is cached in memory, so the same title reopened within one
            // popup session sends no message and reports nothing (use-related).
            const { targetType } = payload as MessageMap['titles.related']['payload'];
            return { name: 'related_opened', params: { type: targetType } };
        }
        default:
            // Everything else is either infrastructure (ping, posters, auth
            // state) or carries something personal by nature. Silence is the
            // default on purpose: an unlisted message reports nothing.
            return null;
    }
}

// Which failures are a failure of Shikimori. The switch is exhaustive over
// ApiError on purpose: a new kind stops compiling here until someone decides
// whether it is one of ours or one of theirs.
export function eventForError(error: ApiError): AnalyticsEvent | null {
    switch (error.kind) {
        case 'network':
        case 'unauthorized':
        case 'rate_limited':
            return { name: 'api_failed', params: { kind: error.kind } };
        case 'api':
            // The only kind carrying an HTTP code. `message` is the server's
            // text and stays out — see the event declaration.
            return { name: 'api_failed', params: { kind: error.kind, status: error.status } };
        case 'internal':
            // The unclassified pile: a closed OAuth window, an unconfigured
            // APP_NAME, a body that failed to parse. Some of it is ours and
            // some is theirs, and the kind carries free-form text either way —
            // reporting it would widen the event past what PRIVACY.md
            // describes. The two cases that are genuinely the server's (an
            // unparseable body, a GraphQL answer with no data) are lost to this
            // silence; classifying them as `api` at the source is the fix, and
            // it changes the message the user sees, so it is its own task.
            return null;
    }
}
