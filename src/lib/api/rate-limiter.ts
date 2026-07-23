// Sliding-window rate limiter for the single network choke point in http.ts.
// Pure logic, no chrome APIs: injectable clock/delay keep it unit-testable
// (docs/02-architecture.md "Rate limiter", CLAUDE.md rule 2).

const SECOND_MS = 1000;
const MINUTE_MS = 60_000;

// Safety margin below the server limits of 5 rps / 90 rpm (CLAUDE.md rule 2).
export const API_RATE_LIMITS = { maxPerSecond: 4, maxPerMinute: 80 } as const;

export interface RateLimiterOptions {
    maxPerSecond: number;
    maxPerMinute: number;
    now?: () => number;
    delay?: (ms: number) => Promise<void>;
}

// Globals are resolved at call time on purpose: the limiter in http.ts is
// created at module load, before fake timers can be installed in tests.
const defaultNow = (): number => Date.now();
const defaultDelay = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

export class RateLimiter {
    private readonly maxPerSecond: number;
    private readonly maxPerMinute: number;
    private readonly now: () => number;
    private readonly delay: (ms: number) => Promise<void>;
    // Start timestamps of requests within the last minute, oldest first.
    private timestamps: number[] = [];
    // Serializes slot acquisition so concurrent schedule() calls stay FIFO
    // and cannot race for the same free slot.
    private tail: Promise<unknown> = Promise.resolve();

    constructor(options: RateLimiterOptions) {
        this.maxPerSecond = options.maxPerSecond;
        this.maxPerMinute = options.maxPerMinute;
        this.now = options.now ?? defaultNow;
        this.delay = options.delay ?? defaultDelay;
    }

    // Waits for a free slot in BOTH windows, then starts the task. Only start
    // times are throttled; the tasks themselves run concurrently.
    schedule<T>(task: () => Promise<T>): Promise<T> {
        const acquired = this.tail.then(() => this.acquireSlot());
        // Keep the chain alive even if an acquisition ever rejects.
        this.tail = acquired.catch(() => undefined);
        return acquired.then(task);
    }

    // Losing the window when the service worker dies is safe: after a restart
    // the empty window still enforces the per-second cap (docs/02).
    reset(): void {
        this.timestamps = [];
    }

    private async acquireSlot(): Promise<void> {
        for (;;) {
            const waitMs = this.nextFreeSlotIn();
            if (waitMs <= 0) {
                break;
            }
            await this.delay(waitMs);
        }
        this.timestamps.push(this.now());
    }

    private nextFreeSlotIn(): number {
        const now = this.now();
        this.timestamps = this.timestamps.filter((ts) => now - ts < MINUTE_MS);
        let waitMs = 0;
        const lastSecond = this.timestamps.filter((ts) => now - ts < SECOND_MS);
        if (lastSecond.length >= this.maxPerSecond) {
            waitMs = Math.max(
                waitMs,
                lastSecond[lastSecond.length - this.maxPerSecond] + SECOND_MS - now,
            );
        }
        if (this.timestamps.length >= this.maxPerMinute) {
            waitMs = Math.max(
                waitMs,
                this.timestamps[this.timestamps.length - this.maxPerMinute] + MINUTE_MS - now,
            );
        }
        return waitMs;
    }
}
