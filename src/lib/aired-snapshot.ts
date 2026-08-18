// Pure snapshot layer of the airing poll (US-12, phase 11): the only place that
// decides what "a new episode came out" means. No chrome.*, no network, no
// clock — the caller hands over the previous snapshot and the current poll
// result and gets the next snapshot plus the increases back.
//
// There is no server field for "the last episode aired at": `episodesAired` is
// the only observable counter, and `nextEpisodeAt` is a prediction forward
// (docs/03, «Уведомления о вышедшей серии»). So the fact is a DIFF against a
// stored snapshot, and everything that could turn that diff into a wrong
// notification lives here rather than in the background tick.

// What the last poll saw: anime id -> episodesAired. A flat record because it
// goes into chrome.storage.local as JSON (docs/02, «Хранилище»).
export type AiredSnapshot = Record<string, number>;

// The minimal poll row this module reads. `AiredPollItem` (src/lib/api/types.ts)
// satisfies it structurally, so the poll result travels here untouched.
export interface AiredObservation {
    targetId: string;
    episodesAired: number;
}

// One title whose counter moved forward. BOTH bounds are carried, not just the
// new value: two episodes can land between two ticks (observed — id 61649 got
// episodes 1 and 2 two minutes apart, docs/03), and the notification text has to
// be able to say «вышли серии 2–3». The new episodes are `from + 1 … to`.
export interface AiredIncrease {
    targetId: string;
    from: number; // episodesAired the previous snapshot held
    to: number; // episodesAired now; always > from
}

export interface AiredDiff {
    snapshot: AiredSnapshot; // to be stored as is; covers exactly the current poll
    increases: AiredIncrease[]; // in the order the observations came in
}

export function diffAired(
    previous: AiredSnapshot | undefined,
    observations: readonly AiredObservation[],
): AiredDiff {
    const snapshot: AiredSnapshot = {};
    const increases: AiredIncrease[] = [];
    // Deduplicated first, last observation wins: a title repeated inside one
    // response would otherwise be compared against the same stale value twice
    // and could produce two increases for one move.
    const current = new Map<string, number>();
    for (const observation of observations) {
        current.set(observation.targetId, observation.episodesAired);
    }

    for (const [targetId, episodesAired] of current) {
        snapshot[targetId] = episodesAired;
        const seen = previous?.[targetId];
        // SILENT SEED. A title the previous snapshot knew nothing about is
        // remembered without an increase: the first poll after adding a title to
        // a list would otherwise report all of its aired episodes at once
        // (docs/06, «Известное ограничение»). The very first poll of a fresh
        // install is the same case, one title at a time.
        if (seen === undefined) {
            continue;
        }
        // A counter that went DOWN is a correction on the server side, not an
        // event: no increase, and the snapshot still takes the new value — kept
        // as the old one, it would swallow the next real episode.
        if (episodesAired > seen) {
            increases.push({ targetId, from: seen, to: episodesAired });
        }
    }

    // Titles missing from the poll (finished, dropped, removed from the list)
    // are simply not copied into the new snapshot: it is rebuilt from the
    // current result every time, so it cannot grow forever.
    return { snapshot, increases };
}

// Storage is untrusted input: a value written by another build, or a
// half-written object, must not reach the diff as NaN and turn into a wrong
// notification. Anything that is not a whole non-negative episode count is
// dropped, and the title is then treated as new — i.e. silently re-seeded.
export function sanitizeAiredSnapshot(value: unknown): AiredSnapshot {
    if (typeof value !== 'object' || value === null) {
        return {};
    }
    const snapshot: AiredSnapshot = {};
    for (const [targetId, episodesAired] of Object.entries(value)) {
        if (
            typeof episodesAired === 'number' &&
            Number.isInteger(episodesAired) &&
            episodesAired >= 0
        ) {
            snapshot[targetId] = episodesAired;
        }
    }
    return snapshot;
}
