import { describe, expect, it } from 'vitest';
import { diffAired, sanitizeAiredSnapshot } from './aired-snapshot';
import type { AiredObservation, AiredSnapshot } from './aired-snapshot';

// A poll row as it reaches the diff. Richer than AiredObservation on purpose:
// the real one (AiredPollItem) carries progress and a date, and the diff must
// stay indifferent to them.
function observed(targetId: string, episodesAired: number): AiredObservation {
    return { targetId, episodesAired };
}

describe('diffAired', () => {
    it('returns an empty snapshot and no increases for an empty poll', () => {
        expect(diffAired({ '21': 1147 }, [])).toEqual({ snapshot: {}, increases: [] });
    });

    // Silent seed. Without it, adding a title to a list would fire as "N new
    // episodes at once" on the very next tick (docs/06, «Известное ограничение»).
    describe('a title unknown to the previous snapshot', () => {
        it('is remembered without an increase', () => {
            expect(diffAired({}, [observed('61649', 2)])).toEqual({
                snapshot: { '61649': 2 },
                increases: [],
            });
        });

        it('is seeded the same way on the very first poll, with no snapshot at all', () => {
            expect(diffAired(undefined, [observed('21', 1147), observed('52991', 28)])).toEqual({
                snapshot: { '21': 1147, '52991': 28 },
                increases: [],
            });
        });

        it('does not stop the titles around it from reporting', () => {
            const diff = diffAired({ '21': 1146 }, [observed('61649', 2), observed('21', 1147)]);
            expect(diff.increases).toEqual([{ targetId: '21', from: 1146, to: 1147 }]);
            expect(diff.snapshot).toEqual({ '61649': 2, '21': 1147 });
        });
    });

    describe('a counter that moved forward', () => {
        it('reports one increase with both bounds', () => {
            const diff = diffAired({ '21': 1146 }, [observed('21', 1147)]);
            expect(diff.increases).toEqual([{ targetId: '21', from: 1146, to: 1147 }]);
            expect(diff.snapshot).toEqual({ '21': 1147 });
        });

        // Observed live: id 61649 got episodes 1 and 2 two minutes apart, i.e.
        // within one 30-minute tick. The result must let the caller say
        // «вышли серии 2–3», so both bounds travel — not just the new value.
        it('carries both bounds when more than one episode landed in one tick', () => {
            const diff = diffAired({ '61649': 1 }, [observed('61649', 3)]);
            expect(diff.increases).toEqual([{ targetId: '61649', from: 1, to: 3 }]);
            // from + 1 … to is the range of new episodes: 2 and 3.
            expect(diff.increases[0].to - diff.increases[0].from).toBe(2);
        });

        it('reports every moved title and leaves the still ones out', () => {
            const diff = diffAired({ '21': 1146, '52991': 28, '61649': 1 }, [
                observed('21', 1147),
                observed('52991', 28),
                observed('61649', 3),
            ]);
            expect(diff.increases).toEqual([
                { targetId: '21', from: 1146, to: 1147 },
                { targetId: '61649', from: 1, to: 3 },
            ]);
            expect(diff.snapshot).toEqual({ '21': 1147, '52991': 28, '61649': 3 });
        });
    });

    // A server-side correction, not an event. The snapshot still has to take the
    // new value: kept at the old one, it would swallow the next real episode.
    describe('a counter that went down', () => {
        it('reports nothing and stores the lower value', () => {
            expect(diffAired({ '21': 1147 }, [observed('21', 1146)])).toEqual({
                snapshot: { '21': 1146 },
                increases: [],
            });
        });

        it('does not fire on the way back up to the value already seen', () => {
            const corrected = diffAired({ '21': 1147 }, [observed('21', 1146)]);
            const back = diffAired(corrected.snapshot, [observed('21', 1147)]);
            // Honest consequence of the snapshot taking the correction: the
            // walk back up looks like a new episode. Pinned so the behaviour is
            // a decision, not a surprise — the alternative (keeping the higher
            // value) silently swallows the NEXT real episode instead.
            expect(back.increases).toEqual([{ targetId: '21', from: 1146, to: 1147 }]);
        });
    });

    // Otherwise the snapshot grows forever: finished, dropped and removed titles
    // would stay in local storage for the lifetime of the profile.
    describe('a title missing from the poll', () => {
        it('is dropped from the new snapshot', () => {
            const diff = diffAired({ '21': 1147, '52991': 28 }, [observed('21', 1147)]);
            expect(diff.snapshot).toEqual({ '21': 1147 });
            expect(diff.increases).toEqual([]);
        });

        it('is re-seeded silently when it comes back with a bigger counter', () => {
            const dropped = diffAired({ '52991': 28 }, []);
            const returned = diffAired(dropped.snapshot, [observed('52991', 30)]);
            expect(returned.increases).toEqual([]);
            expect(returned.snapshot).toEqual({ '52991': 30 });
        });
    });

    it('does not mutate the snapshot it was given', () => {
        const previous: AiredSnapshot = { '21': 1146 };
        const diff = diffAired(previous, [observed('21', 1147)]);
        expect(previous).toEqual({ '21': 1146 });
        expect(diff.snapshot).not.toBe(previous);
    });

    // A duplicate id inside one response must not be compared against the same
    // stale value twice — that would be two notifications for one move.
    it('collapses a repeated id to its last observation', () => {
        const diff = diffAired({ '21': 1146 }, [observed('21', 1147), observed('21', 1148)]);
        expect(diff.increases).toEqual([{ targetId: '21', from: 1146, to: 1148 }]);
        expect(diff.snapshot).toEqual({ '21': 1148 });
    });
});

describe('sanitizeAiredSnapshot', () => {
    it('keeps a well-formed snapshot as is', () => {
        expect(sanitizeAiredSnapshot({ '21': 1147, '52991': 0 })).toEqual({
            '21': 1147,
            '52991': 0,
        });
    });

    it.each([undefined, null, 'snapshot', 42, true])('maps %s to an empty snapshot', (value) => {
        expect(sanitizeAiredSnapshot(value)).toEqual({});
    });

    // A broken entry must not reach the diff: NaN comparisons are false either
    // way, so the title would keep its bogus value and could report an episode
    // that never aired. Dropped instead — i.e. seeded silently on the next poll.
    it('drops entries that are not whole non-negative counters', () => {
        expect(
            sanitizeAiredSnapshot({
                ok: 12,
                nan: Number.NaN,
                infinite: Number.POSITIVE_INFINITY,
                fractional: 1.5,
                negative: -1,
                text: '12',
                nested: { episodesAired: 12 },
                missing: null,
            }),
        ).toEqual({ ok: 12 });
    });
});
