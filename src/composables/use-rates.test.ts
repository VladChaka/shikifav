import { beforeEach, describe, expect, it } from 'vitest';
import { nextTick, ref } from 'vue';
import type { Ref } from 'vue';
import { fakeBrowser } from 'wxt/testing';
import { onMessage } from '../lib/messaging';
import type { MessageHandlers } from '../lib/messaging';
import { getSession, setSession } from '../lib/storage';
import { i18n } from '../lib/i18n';
import type { ApiError, TitleCard, UserRateRef } from '../lib/api/types';
import { OPTIMISTIC_RATE_ID, applyRateAction, rollbackRateAction, useRates } from './use-rates';
import type { UseRates } from './use-rates';

function card(id: string, userRate: UserRateRef | null = null): TitleCard {
    return {
        id,
        name: `Title ${id}`,
        russian: null,
        kind: 'tv',
        score: 8,
        status: 'released',
        episodes: 12,
        episodesAired: 12,
        year: 2020,
        posterUrl: null,
        posterUrl2x: null,
        userRate,
    };
}

function deferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
} {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('rate action reducer', () => {
    it('create: userRate appears with the chosen status and a pending id', () => {
        const source = card('1');
        const { card: next } = applyRateAction(source, { type: 'create', status: 'watching' });
        expect(next.userRate).toEqual({ id: OPTIMISTIC_RATE_ID, status: 'watching' });
    });

    it('update: the status changes, the server id is kept', () => {
        const source = card('1', { id: '9', status: 'planned' });
        const { card: next } = applyRateAction(source, { type: 'update', status: 'dropped' });
        expect(next.userRate).toEqual({ id: '9', status: 'dropped' });
    });

    it('delete: userRate becomes null', () => {
        const source = card('1', { id: '9', status: 'planned' });
        const { card: next } = applyRateAction(source, { type: 'delete' });
        expect(next.userRate).toBeNull();
    });

    it('does not mutate the input card', () => {
        const source = card('1', { id: '9', status: 'planned' });
        applyRateAction(source, { type: 'delete' });
        applyRateAction(source, { type: 'update', status: 'completed' });
        expect(source.userRate).toEqual({ id: '9', status: 'planned' });
    });

    it('rollback returns the pre-action card', () => {
        const source = card('1', { id: '9', status: 'planned' });
        const { snapshot } = applyRateAction(source, { type: 'delete' });
        expect(rollbackRateAction(snapshot)).toBe(source);
    });
});

interface Setup {
    items: Ref<TitleCard[]>;
    toasts: string[];
    rates: UseRates;
}

function setup(initial: TitleCard[], overrides: Partial<MessageHandlers> = {}): Setup {
    onMessage({
        ping: async () => ({ pong: true }),
        'auth.getState': async () => ({ status: 'anonymous' }),
        'auth.login': async () => ({
            user: { id: 1, nickname: 'tester', avatarUrl: '' },
        }),
        'auth.logout': async () => ({}),
        'search.titles': async () => ({ items: [] }),
        'rates.create': async () => ({ rate: { id: '100', status: 'planned' } }),
        'rates.update': async () => ({ rate: { id: '100', status: 'watching' } }),
        'rates.delete': async () => ({}),
        ...overrides,
    });
    const items = ref(initial);
    const toasts: string[] = [];
    const rates = useRates(items, (text) => toasts.push(text));
    return { items, toasts, rates };
}

describe('use-rates', () => {
    beforeEach(() => {
        fakeBrowser.reset();
    });

    it('create: the optimistic rate is replaced by the server one', async () => {
        const server = deferred<{ rate: UserRateRef }>();
        const payloads: unknown[] = [];
        const { items, toasts, rates } = setup([card('1')], {
            'rates.create': async (payload) => {
                payloads.push(payload);
                return server.promise;
            },
        });

        const action = rates.performAction(items.value[0], { type: 'create', status: 'planned' });
        // The optimistic patch is synchronous: visible before the response.
        expect(items.value[0].userRate).toEqual({ id: OPTIMISTIC_RATE_ID, status: 'planned' });
        expect(rates.busyIds.value.has('1')).toBe(true);

        server.resolve({ rate: { id: '55', status: 'planned' } });
        await action;
        expect(items.value[0].userRate).toEqual({ id: '55', status: 'planned' });
        expect(rates.busyIds.value.has('1')).toBe(false);
        expect(toasts).toEqual([]);
        expect(payloads).toEqual([{ targetId: '1', targetType: 'Anime', status: 'planned' }]);
    });

    it('network failure: rollback + toast', async () => {
        const { items, toasts, rates } = setup([card('1')], {
            'rates.create': async () => {
                throw { kind: 'network' } satisfies ApiError;
            },
        });

        await rates.performAction(items.value[0], { type: 'create', status: 'planned' });
        expect(items.value[0].userRate).toBeNull();
        expect(toasts).toEqual([i18n.errors.network]);
        expect(rates.busyIds.value.size).toBe(0);
    });

    it('unauthorized: rollback + inline warning, no toast, single request', async () => {
        let calls = 0;
        const { items, toasts, rates } = setup([card('1', { id: '9', status: 'planned' })], {
            'rates.update': async () => {
                calls += 1;
                throw { kind: 'unauthorized' } satisfies ApiError;
            },
        });

        await rates.performAction(items.value[0], { type: 'update', status: 'watching' });
        expect(items.value[0].userRate).toEqual({ id: '9', status: 'planned' });
        expect(rates.warnings.value.get('1')).toBe(i18n.errors.editForbidden);
        expect(toasts).toEqual([]);
        expect(calls).toBe(1);
    });

    it('api 403 maps to the same inline warning as unauthorized', async () => {
        const { items, toasts, rates } = setup([card('1')], {
            'rates.create': async () => {
                throw { kind: 'api', status: 403, message: 'Forbidden' } satisfies ApiError;
            },
        });

        await rates.performAction(items.value[0], { type: 'create', status: 'planned' });
        expect(items.value[0].userRate).toBeNull(); // rolled back
        expect(rates.warnings.value.get('1')).toBe(i18n.errors.editForbidden);
        expect(toasts).toEqual([]);
    });

    it('404 on delete: userRate stays null without a rollback', async () => {
        const { items, toasts, rates } = setup([card('1', { id: '9', status: 'planned' })], {
            'rates.delete': async () => {
                throw { kind: 'api', status: 404, message: 'Not Found' } satisfies ApiError;
            },
        });

        await rates.performAction(items.value[0], { type: 'delete' });
        expect(items.value[0].userRate).toBeNull();
        expect(toasts).toEqual([i18n.rates.alreadyRemoved]);
        expect(rates.warnings.value.size).toBe(0);
    });

    it('404 on update: the title becomes "not in list" instead of rolling back', async () => {
        const { items, rates } = setup([card('1', { id: '9', status: 'planned' })], {
            'rates.update': async () => {
                throw { kind: 'api', status: 404, message: 'Not Found' } satisfies ApiError;
            },
        });

        await rates.performAction(items.value[0], { type: 'update', status: 'watching' });
        expect(items.value[0].userRate).toBeNull();
    });

    it('422: the toast shows the validation message from the body', async () => {
        const { items, toasts, rates } = setup([card('1')], {
            'rates.create': async () => {
                throw {
                    kind: 'api',
                    status: 422,
                    message: 'Target must exist',
                } satisfies ApiError;
            },
        });

        await rates.performAction(items.value[0], { type: 'create', status: 'planned' });
        expect(items.value[0].userRate).toBeNull();
        expect(toasts).toEqual(['Target must exist']);
    });

    it('rate_limited on a write: rollback + toast, no automatic retry', async () => {
        // Policy from docs/02: writes are never auto-retried on 429 — the error
        // must surface after exactly one request.
        let calls = 0;
        const { items, toasts, rates } = setup([card('1', { id: '9', status: 'planned' })], {
            'rates.update': async () => {
                calls += 1;
                throw { kind: 'rate_limited', retryAfterMs: 3000 } satisfies ApiError;
            },
        });

        await rates.performAction(items.value[0], { type: 'update', status: 'watching' });
        expect(items.value[0].userRate).toEqual({ id: '9', status: 'planned' }); // rolled back
        expect(toasts).toEqual([i18n.errors.rateLimited]);
        expect(calls).toBe(1);
        expect(rates.warnings.value.size).toBe(0);
    });

    it('late success for a card removed from items is a no-op without a crash', async () => {
        const server = deferred<{ rate: UserRateRef }>();
        const { items, rates } = setup([card('1')], {
            'rates.create': async () => server.promise,
        });

        const action = rates.performAction(items.value[0], { type: 'create', status: 'planned' });
        items.value = [card('2')]; // a new search replaced the results mid-flight
        await nextTick();

        server.resolve({ rate: { id: '55', status: 'planned' } });
        await expect(action).resolves.toBeUndefined();
        expect(items.value).toEqual([card('2')]); // the late patch has nowhere to land
        expect(rates.busyIds.value.size).toBe(0);
        expect(rates.warnings.value.size).toBe(0);
    });

    it('late failure for a removed card: no rollback patch, the toast still reports it', async () => {
        const server = deferred<{ rate: UserRateRef }>();
        const { items, toasts, rates } = setup([card('1')], {
            'rates.create': async () => server.promise,
        });

        const action = rates.performAction(items.value[0], { type: 'create', status: 'planned' });
        items.value = [card('2')];
        await nextTick();

        server.reject({ kind: 'network' } satisfies ApiError);
        await expect(action).resolves.toBeUndefined();
        expect(items.value).toEqual([card('2')]);
        expect(toasts).toEqual([i18n.errors.network]); // the user still learns the write failed
        expect(rates.busyIds.value.size).toBe(0);
    });

    it('update/delete with only an optimistic rate id never reaches the server', async () => {
        // OPTIMISTIC_RATE_ID is a local placeholder: sending it to the API is
        // forbidden (use-rates.ts invariant). Normally unreachable via the busy
        // lock; this covers the defensive guard directly.
        let calls = 0;
        const { items, rates } = setup(
            [card('1', { id: OPTIMISTIC_RATE_ID, status: 'planned' })],
            {
                'rates.update': async () => {
                    calls += 1;
                    return { rate: { id: '1', status: 'watching' } };
                },
                'rates.delete': async () => {
                    calls += 1;
                    return {};
                },
            },
        );

        await rates.performAction(items.value[0], { type: 'update', status: 'watching' });
        await rates.performAction(items.value[0], { type: 'delete' });
        expect(calls).toBe(0);
        expect(items.value[0].userRate).toEqual({ id: OPTIMISTIC_RATE_ID, status: 'planned' });
    });

    it('busy card ignores a second action while the first is in flight', async () => {
        const server = deferred<{ rate: UserRateRef }>();
        let createCalls = 0;
        let deleteCalls = 0;
        const { items, rates } = setup([card('1')], {
            'rates.create': async () => {
                createCalls += 1;
                return server.promise;
            },
            'rates.delete': async () => {
                deleteCalls += 1;
                return {};
            },
        });

        const first = rates.performAction(items.value[0], { type: 'create', status: 'planned' });
        await rates.performAction(items.value[0], { type: 'delete' }); // dropped: busy
        expect(deleteCalls).toBe(0);
        expect(items.value[0].userRate).toEqual({ id: OPTIMISTIC_RATE_ID, status: 'planned' });

        server.resolve({ rate: { id: '7', status: 'planned' } });
        await first;
        expect(createCalls).toBe(1);
        expect(items.value[0].userRate).toEqual({ id: '7', status: 'planned' });
    });

    it('a successful action refreshes session.lastSearch', async () => {
        const initial = card('1');
        await setSession('lastSearch', { query: 'frieren', type: 'anime', items: [initial] });
        const { items, rates } = setup([initial], {
            'rates.create': async () => ({ rate: { id: '55', status: 'watching' } }),
        });

        await rates.performAction(items.value[0], { type: 'create', status: 'watching' });
        expect(await getSession('lastSearch')).toEqual({
            query: 'frieren',
            type: 'anime',
            items: [{ ...initial, userRate: { id: '55', status: 'watching' } }],
        });
    });

    it('replacing the items list clears warnings and busy flags', async () => {
        const { items, rates } = setup([card('1')], {
            'rates.create': async () => {
                throw { kind: 'unauthorized' } satisfies ApiError;
            },
        });

        await rates.performAction(items.value[0], { type: 'create', status: 'planned' });
        expect(rates.warnings.value.get('1')).toBe(i18n.errors.editForbidden);

        items.value = [card('1'), card('2')]; // e.g. a new search response
        await nextTick();
        expect(rates.warnings.value.size).toBe(0);
        expect(rates.busyIds.value.size).toBe(0);
    });

    it('parallel actions keep both patches in session.lastSearch', async () => {
        const one = card('1');
        const two = card('2');
        await setSession('lastSearch', { query: 'frieren', type: 'anime', items: [one, two] });
        const { items, rates } = setup([one, two], {
            'rates.create': async ({ targetId, status }) => ({
                rate: { id: `10${targetId}`, status },
            }),
        });

        await Promise.all([
            rates.performAction(items.value[0], { type: 'create', status: 'planned' }),
            rates.performAction(items.value[1], { type: 'create', status: 'watching' }),
        ]);
        const cached = await getSession('lastSearch');
        expect(cached?.items.map((item) => item.userRate)).toEqual([
            { id: '101', status: 'planned' },
            { id: '102', status: 'watching' },
        ]);
    });

    it('a failed action leaves session.lastSearch untouched', async () => {
        const initial = card('1');
        await setSession('lastSearch', { query: 'frieren', type: 'anime', items: [initial] });
        const { items, rates } = setup([initial], {
            'rates.create': async () => {
                throw { kind: 'network' } satisfies ApiError;
            },
        });

        await rates.performAction(items.value[0], { type: 'create', status: 'planned' });
        expect(await getSession('lastSearch')).toEqual({
            query: 'frieren',
            type: 'anime',
            items: [initial],
        });
    });
});
