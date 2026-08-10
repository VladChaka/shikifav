import type { ApiError, RateTargetType, SearchType, UserRateStatus } from './api/types';
import type { PopupTab, Theme } from './storage';

// The complete vocabulary of what the extension is allowed to report.
//
// It is a closed union and not `track(name: string, params: object)` on
// purpose. An open signature is one careless call away from carrying a search
// query, a title the user is reading or a nickname — and the promise in
// PRIVACY.md is exactly that none of those leave the browser. Here every
// parameter is either a counter or a member of a fixed vocabulary the code
// already has, so free text cannot enter an event even by accident.
//
// The rule for adding an event: if a parameter could ever hold something the
// user typed or chose to read, it does not belong here.

export type AnalyticsEvent =
    // Which surface people actually open, and on which tab (Ф10-1). The tab
    // vocabulary is the popup's own, so no new strings enter the wire.
    | { name: 'popup_opened'; params: { tab: PopupTab } }
    // That a search happened and over which catalogue. The query is NEVER a
    // parameter — this is the event the whole closed-union rule exists for.
    | { name: 'search_performed'; params: { type: SearchType } }
    // Which entry points people use to add a title, and as what. The REST
    // write target ('Anime' / 'Manga'), not the search vocabulary: ranobe is
    // written as 'Manga', and inventing a third value here would be a claim the
    // request itself never made.
    | { name: 'rate_created'; params: { type: RateTargetType; status: UserRateStatus } }
    // What gets edited afterwards. `field` says which control was used, never
    // the value it moved to — a score is a number about a specific title.
    | { name: 'rate_updated'; params: { field: 'status' | 'score' | 'progress' } }
    | { name: 'rate_deleted'; params: Record<string, never> }
    // «+1 эпизод» versus typing the episode number in (Ф7 addition): the two
    // paths exist to answer exactly this question.
    | { name: 'episode_incremented'; params: { by: 'step' | 'typed' } }
    | { name: 'calendar_opened'; params: Record<string, never> }
    // The «Связанные» screen (Ф12), reported with the write target of the title
    // it was opened FROM — 'Anime' vs 'Manga' answers whether the screen is used
    // from anime or from the manga/ranobe side, and that is the whole question.
    // The number of links is NOT a parameter and must not become one: a count is
    // a fingerprint of one specific title (92 links is One Piece and nothing
    // else), so it would name what the user is reading just as plainly as the id
    // or the title itself would.
    | { name: 'related_opened'; params: { type: RateTargetType } }
    | { name: 'context_menu_used'; params: Record<string, never> }
    // Which settings people actually change. Values are only sent for settings
    // whose vocabulary is fixed and impersonal; `origin` and `theme` qualify,
    // and nothing else is reported with a value.
    | { name: 'setting_changed'; params: { setting: string; value?: Theme | 'one' | 'io' } }
    // Failures as the code already classifies them (docs/02 error model): the
    // ApiError kind and, when there is one, the HTTP status. Never a message
    // and never a URL — `tabs.create` taught that a URL can quote the user's
    // own selection back (README of the context menu work).
    | { name: 'api_failed'; params: { kind: ReportedErrorKind; status?: number } };

// The event promises «ошибки обращения к Shikimori» (PRIVACY.md, docs/07), and
// 'internal' is not one: it is the extension's own fault — a closed OAuth
// window, an unregistered token provider — with no request behind it. Excluded
// by type so no caller can report one, and derived from ApiError rather than
// spelled out so a future kind has to be classified in eventForError() first.
export type ReportedErrorKind = Exclude<ApiError['kind'], 'internal'>;

export type AnalyticsEventName = AnalyticsEvent['name'];

// GA4 Measurement Protocol body. Built here rather than in the transport so the
// shape can be asserted in a test without touching fetch.
export interface MeasurementPayload {
    client_id: string;
    // Chrome extensions have no consent-mode plumbing, and GA4 would otherwise
    // guess a session from the request; an explicit engagement time keeps the
    // event from being dropped as sessionless.
    events: { name: string; params: Record<string, string | number> }[];
}

export function toMeasurementPayload(
    clientId: string,
    event: AnalyticsEvent,
    version: string,
): MeasurementPayload {
    const params: Record<string, string | number> = {
        // GA4 discards events it considers sessionless; a nominal engagement
        // time is the documented way to keep server-side events counted.
        engagement_time_msec: 1,
        // Which build reported it — the one dimension that makes a regression
        // visible after a store update.
        extension_version: version,
    };
    for (const [key, value] of Object.entries(event.params)) {
        if (value !== undefined) {
            params[key] = value as string | number;
        }
    }
    return { client_id: clientId, events: [{ name: event.name, params }] };
}
