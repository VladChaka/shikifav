import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_RATE_LIMITS, RateLimiter } from './rate-limiter';

// Schedules `count` tasks at once and records their (fake) start times.
function trackedTasks(limiter: RateLimiter, count: number) {
    const startedAt: number[] = [];
    const results = Array.from({ length: count }, (_, index) =>
        limiter.schedule(async () => {
            startedAt.push(Date.now());
            return index;
        }),
    );
    return { startedAt, results };
}

describe('rate-limiter', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('keeps the configured safety margin below the 5 rps / 90 rpm server limits', () => {
        expect(API_RATE_LIMITS).toEqual({ maxPerSecond: 4, maxPerMinute: 80 });
    });

    it('starts at most 4 of 10 concurrent tasks within the first second', async () => {
        const limiter = new RateLimiter(API_RATE_LIMITS);
        const { startedAt, results } = trackedTasks(limiter, 10);

        await vi.advanceTimersByTimeAsync(0);
        expect(startedAt).toHaveLength(4);

        await vi.advanceTimersByTimeAsync(999);
        expect(startedAt).toHaveLength(4);

        await vi.advanceTimersByTimeAsync(1);
        expect(startedAt).toHaveLength(8);

        await vi.advanceTimersByTimeAsync(1000);
        expect(startedAt).toHaveLength(10);

        // FIFO: tasks resolve with their submission indexes intact.
        await expect(Promise.all(results)).resolves.toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it('makes the 81st request in a minute wait for the window to free up', async () => {
        const limiter = new RateLimiter(API_RATE_LIMITS);
        const { startedAt, results } = trackedTasks(limiter, 81);

        // 80 requests drain at 4 rps over 20 seconds.
        await vi.advanceTimersByTimeAsync(19_000);
        expect(startedAt).toHaveLength(80);

        await vi.advanceTimersByTimeAsync(40_999);
        expect(startedAt).toHaveLength(80);

        // The 81st starts exactly when the very first timestamp leaves the
        // one-minute window.
        await vi.advanceTimersByTimeAsync(1);
        expect(startedAt).toHaveLength(81);
        expect(startedAt[80] - startedAt[0]).toBe(60_000);

        await Promise.all(results);
    });

    it('enforces both windows at the same time', async () => {
        const limiter = new RateLimiter({ maxPerSecond: 4, maxPerMinute: 6 });
        const { startedAt, results } = trackedTasks(limiter, 10);

        // First second is capped by rps...
        await vi.advanceTimersByTimeAsync(0);
        expect(startedAt).toHaveLength(4);

        // ...then the minute cap (6) takes over.
        await vi.advanceTimersByTimeAsync(1000);
        expect(startedAt).toHaveLength(6);

        await vi.advanceTimersByTimeAsync(58_999);
        expect(startedAt).toHaveLength(6);

        await vi.advanceTimersByTimeAsync(1);
        expect(startedAt).toHaveLength(10);

        await Promise.all(results);
    });

    it('reset clears the sliding window', async () => {
        const limiter = new RateLimiter(API_RATE_LIMITS);
        trackedTasks(limiter, 4);
        await vi.advanceTimersByTimeAsync(0);

        limiter.reset();

        const { startedAt } = trackedTasks(limiter, 4);
        await vi.advanceTimersByTimeAsync(0);
        expect(startedAt).toHaveLength(4);
    });

    it('uses injected now() and delay() instead of globals when provided', async () => {
        let currentTime = 0;
        const delays: number[] = [];
        const limiter = new RateLimiter({
            maxPerSecond: 1,
            maxPerMinute: 100,
            now: () => currentTime,
            delay: async (ms) => {
                delays.push(ms);
                currentTime += ms;
            },
        });

        const { startedAt } = trackedTasks(limiter, 3);
        // The injected clock/delay never touch fake timers: a plain microtask
        // drain is enough for all three tasks to pass through.
        await vi.advanceTimersByTimeAsync(0);
        expect(delays).toEqual([1000, 1000]);
        expect(startedAt).toHaveLength(3);
    });
});
