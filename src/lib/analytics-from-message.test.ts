import { describe, expect, it } from 'vitest';
import { eventForMessage } from './analytics-from-message';
import type { MessageType } from './messaging';

// This file is the answer to "what does the extension report?", so the tests
// are written as that answer: what turns into an event, what deliberately does
// not, and — the one that matters — that the search query never survives the
// trip.
describe('eventForMessage', () => {
    it('reports the catalogue of a search and drops the query', () => {
        const event = eventForMessage('search.titles', {
            query: 'что-то очень личное',
            type: 'ranobe',
        });

        expect(event).toEqual({ name: 'search_performed', params: { type: 'ranobe' } });
        expect(JSON.stringify(event)).not.toContain('личное');
    });

    it('reports an added title as its write target and status', () => {
        expect(
            eventForMessage('rates.create', {
                targetId: '123',
                targetType: 'Anime',
                status: 'watching',
            }),
        ).toEqual({ name: 'rate_created', params: { type: 'Anime', status: 'watching' } });
    });

    it.each([
        [{ status: 'completed' }, 'status'],
        [{ score: 9 }, 'score'],
    ])('reports which control moved, not the value (%o)', (patch, field) => {
        const event = eventForMessage('rates.update', { rateId: '1', patch });

        expect(event).toEqual({ name: 'rate_updated', params: { field } });
        // A score belongs to one specific title — the number stays home.
        expect(JSON.stringify(event)).not.toContain('9');
    });

    it('separates a typed episode number from the «+1» button', () => {
        expect(eventForMessage('rates.update', { rateId: '1', patch: { episodes: 6 } })).toEqual({
            name: 'episode_incremented',
            params: { by: 'typed' },
        });
        expect(eventForMessage('rates.increment', { rateId: '1' })).toEqual({
            name: 'episode_incremented',
            params: { by: 'step' },
        });
    });

    it('reports a removal without saying what was removed', () => {
        expect(eventForMessage('rates.delete', { rateId: '42' })).toEqual({
            name: 'rate_deleted',
            params: {},
        });
    });

    it('reports nothing for a patch it has no event for', () => {
        // `text` is a user-written note: there is no event that could carry it,
        // and the mapping stays silent rather than inventing one.
        expect(
            eventForMessage('rates.update', { rateId: '1', patch: { text: 'заметка' } }),
        ).toBeNull();
    });

    it.each([
        ['ping'],
        ['auth.login'],
        ['auth.getState'],
        ['auth.logout'],
        ['rates.list'],
        ['posters.fetch'],
        ['settings.setOrigin'],
        ['analytics.track'],
    ])('stays silent for %s', (type) => {
        // Silence is the default: a message has to be added to the mapping on
        // purpose before it reports anything.
        expect(eventForMessage(type as MessageType, {})).toBeNull();
    });
});
