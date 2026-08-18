import { describe, expect, it } from 'vitest';
import { bumpSessionEpoch, isSessionEpochCurrent, sessionEpoch } from './session-epoch';

// Ф11-10. The fence the background tick takes before its poll and checks before
// its writes. Deliberately without a reset between tests: the counter only ever
// moves forward and is only ever compared for equality, so an absolute value has
// no meaning to anybody.

describe('session epoch', () => {
    it('holds the epoch it was read at', () => {
        expect(isSessionEpochCurrent(sessionEpoch())).toBe(true);
    });

    // The whole point: work that started under the previous session must be able
    // to find out that it did.
    it('invalidates an epoch taken before a bump', () => {
        const taken = sessionEpoch();

        bumpSessionEpoch();

        expect(isSessionEpochCurrent(taken)).toBe(false);
        expect(isSessionEpochCurrent(sessionEpoch())).toBe(true);
    });

    // Two sessions ending back to back must not bring an old epoch back — a
    // counter that wrapped, or toggled, would silently unfence a stale tick.
    it('never returns to an epoch it has left', () => {
        const first = sessionEpoch();

        bumpSessionEpoch();
        bumpSessionEpoch();

        expect(isSessionEpochCurrent(first)).toBe(false);
        expect(sessionEpoch()).toBeGreaterThan(first);
    });
});
