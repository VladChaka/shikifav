import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import type { MessageHandlers } from '../lib/messaging';
import { i18n } from '../lib/i18n';
import type { ApiError, RelatedItem, RelationKind, TitleCard } from '../lib/api/types';
import type { RelatedTarget, UseRelated } from './use-related';

// Ф12-7: the related-titles screen state — four states, one request per title,
// a memory-only cache and the portioned rendering. The pure grouping is covered
// in lib/related.test.ts; what is checked here is everything the screen adds
// around it.

const HOST: RelatedTarget = {
    targetId: '21',
    targetType: 'Anime',
    name: 'One Piece',
    russian: 'Ван-Пис',
};

const OTHER_HOST: RelatedTarget = {
    targetId: '5114',
    targetType: 'Anime',
    name: 'Fullmetal Alchemist: Brotherhood',
    russian: 'Стальной алхимик: Братство',
};

function card(id: string, overrides: Partial<TitleCard> = {}): TitleCard {
    return {
        id,
        targetType: 'Anime',
        name: `Title ${id}`,
        russian: null,
        kind: 'tv',
        score: null,
        status: null,
        year: 2000,
        posterUrl: null,
        posterUrl2x: null,
        userRate: null,
        ...overrides,
    };
}

function item(kind: RelationKind, id: string, overrides: Partial<TitleCard> = {}): RelatedItem {
    return { relationKind: kind, relationText: 'Связь', card: card(id, overrides) };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

// Drains the microtask queue plus one macrotask tick, so "nothing happened"
// assertions observe a settled state (no timer logic lives in use-related).
function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function handlers(overrides: Partial<MessageHandlers>): MessageHandlers {
    return {
        ping: async () => ({ pong: true }),
        'auth.getState': async () => ({ status: 'anonymous' }),
        'auth.login': async () => ({ user: { id: 1, nickname: 'tester', avatarUrl: '' } }),
        'auth.logout': async () => ({}),
        'search.titles': async () => ({ items: [] }),
        'rates.list': async () => ({ items: [], hasMore: false }),
        'calendar.list': async () => ({ items: [] }),
        'titles.related': async () => ({ items: [] }),
        'posters.fetch': async () => ({ posters: {} }),
        'rates.create': async () => ({ rate: { id: '100', status: 'planned' } }),
        'rates.update': async () => ({
            rate: { id: '100', status: 'watching', score: 0, episodes: 0, chapters: 0, volumes: 0 },
        }),
        'rates.delete': async () => ({}),
        'rates.increment': async () => ({
            rate: { id: '100', status: 'watching', score: 0, episodes: 0, chapters: 0, volumes: 0 },
        }),
        'settings.setOrigin': async () => ({}),
        'analytics.track': async () => ({}),
        ...overrides,
    };
}

interface Setup {
    related: UseRelated;
    toasts: string[];
}

// The composable keeps shared module-level state (including the in-memory
// cache), so every test builds a fresh module graph — pattern of
// use-calendar.test.ts.
async function setup(overrides: Partial<MessageHandlers> = {}): Promise<Setup> {
    vi.resetModules();
    const messaging = await import('../lib/messaging');
    messaging.onMessage(handlers(overrides));
    const composable = await import('./use-related');
    const toasts: string[] = [];
    return {
        related: composable.useRelated((text) => toasts.push(text)),
        toasts,
    };
}

// Rows of every rendered group, flattened — what the screen would actually draw.
function renderedIds(related: UseRelated): string[] {
    return related.groups.value.flatMap((group) => group.items.map((row) => row.card.id));
}

describe('use-related', () => {
    beforeEach(() => {
        fakeBrowser.reset();
    });

    describe('loading', () => {
        it('costs nothing until the screen is entered', async () => {
            let calls = 0;
            const { related } = await setup({
                'titles.related': async () => {
                    calls += 1;
                    return { items: [item('sequel', '1')] };
                },
            });

            await flush();
            expect(calls).toBe(0); // opening the popup asks for no relations
            expect(related.target.value).toBeNull();

            related.open(HOST);
            expect(related.screenStatus.value).toBe('skeleton');
            await vi.waitFor(() => expect(related.screenStatus.value).toBe('data'));
            expect(calls).toBe(1);
            expect(related.target.value).toEqual(HOST);
        });

        it('asks for the title it was opened on', async () => {
            const asked: { targetId: string; targetType: string }[] = [];
            const { related } = await setup({
                'titles.related': async (payload) => {
                    asked.push(payload);
                    return { items: [] };
                },
            });

            related.open({
                targetId: '7',
                targetType: 'Manga',
                name: 'Berserk',
                russian: 'Берсерк',
            });
            await vi.waitFor(() => expect(asked).toHaveLength(1));
            expect(asked[0]).toEqual({ targetId: '7', targetType: 'Manga' });
        });

        it('groups the flat answer in the reading order of the screen', async () => {
            const { related } = await setup({
                'titles.related': async () => ({
                    items: [
                        item('other', '3'),
                        item('adaptation', '2', { targetType: 'Manga', kind: 'manga' }),
                        item('sequel', '1'),
                    ],
                }),
            });

            related.open(HOST);
            await vi.waitFor(() => expect(related.screenStatus.value).toBe('data'));
            expect(related.groups.value.map((group) => group.kind)).toEqual([
                'sequel',
                'adaptation',
                'other',
            ]);
            expect(renderedIds(related)).toEqual(['1', '2', '3']);
            expect(related.total.value).toBe(3);
            expect(related.hasMore.value).toBe(false);
        });

        it('keeps the server relation text on the row', async () => {
            const { related } = await setup({
                'titles.related': async () => ({
                    items: [
                        {
                            relationKind: 'adaptation',
                            relationText: 'Адаптация',
                            card: card('2', { targetType: 'Manga', kind: 'manga' }),
                        },
                    ],
                }),
            });

            related.open(HOST);
            await vi.waitFor(() => expect(related.screenStatus.value).toBe('data'));
            expect(related.groups.value[0].items[0].relationText).toBe('Адаптация');
        });

        it('reports an empty answer as a state, not as a failure', async () => {
            const { related } = await setup({ 'titles.related': async () => ({ items: [] }) });

            related.open(HOST);
            await vi.waitFor(() => expect(related.screenStatus.value).toBe('empty'));
            expect(related.groups.value).toEqual([]);
            expect(related.total.value).toBe(0);
            expect(related.errorText.value).toBeUndefined();
        });
    });

    describe('errors', () => {
        it('shows the Russian message, never the text the server sent', async () => {
            // What a GraphQL complexity refusal really looks like on the wire
            // (docs/03): HTTP 200 with an English errors[] entry.
            const error: ApiError = {
                kind: 'api',
                status: 200,
                message: 'Query has complexity of 207, which exceeds max complexity of 190',
            };
            const { related } = await setup({
                'titles.related': async () => {
                    throw error;
                },
            });

            related.open(HOST);
            await vi.waitFor(() => expect(related.screenStatus.value).toBe('error'));
            expect(related.errorText.value).toBe(i18n.errors.api);
            expect(related.errorText.value).not.toContain('complexity');
        });

        it('retries the same title and keeps the screen open', async () => {
            let calls = 0;
            const { related } = await setup({
                'titles.related': async () => {
                    calls += 1;
                    if (calls === 1) {
                        throw { kind: 'network' } satisfies ApiError;
                    }
                    return { items: [item('sequel', '1')] };
                },
            });

            related.open(HOST);
            await vi.waitFor(() => expect(related.screenStatus.value).toBe('error'));
            expect(related.target.value).toEqual(HOST); // the return bar stays

            related.retry();
            await vi.waitFor(() => expect(related.screenStatus.value).toBe('data'));
            expect(calls).toBe(2);
            expect(related.errorText.value).toBeUndefined();
        });

        it('re-entering after a failure is a fresh attempt', async () => {
            let calls = 0;
            const { related } = await setup({
                'titles.related': async () => {
                    calls += 1;
                    if (calls === 1) {
                        throw { kind: 'network' } satisfies ApiError;
                    }
                    return { items: [item('sequel', '1')] };
                },
            });

            related.open(HOST);
            await vi.waitFor(() => expect(related.screenStatus.value).toBe('error'));
            related.close();
            related.open(HOST);
            await vi.waitFor(() => expect(related.screenStatus.value).toBe('data'));
            expect(calls).toBe(2); // a failure is not cached
        });
    });

    describe('memory cache', () => {
        it('re-opening the same title costs no request at all', async () => {
            let calls = 0;
            const { related } = await setup({
                'titles.related': async () => {
                    calls += 1;
                    return { items: [item('sequel', '1'), item('prequel', '2')] };
                },
            });

            related.open(HOST);
            await vi.waitFor(() => expect(related.screenStatus.value).toBe('data'));
            related.close();

            related.open(HOST);
            // Synchronously: no skeleton, no network, rows straight from memory.
            expect(related.screenStatus.value).toBe('data');
            expect(renderedIds(related)).toEqual(['1', '2']);
            await flush();
            expect(calls).toBe(1);
        });

        it('caches per (targetType, targetId), not per id', async () => {
            const asked: string[] = [];
            const { related } = await setup({
                'titles.related': async (payload) => {
                    asked.push(`${payload.targetType}:${payload.targetId}`);
                    return { items: [] };
                },
            });

            related.open(HOST);
            await vi.waitFor(() => expect(asked).toHaveLength(1));
            related.open({ ...HOST, targetType: 'Manga' });
            await vi.waitFor(() => expect(asked).toHaveLength(2));
            expect(asked).toEqual(['Anime:21', 'Manga:21']);
        });

        it('writes nothing to storage.session', async () => {
            const sessionSet = vi.spyOn(fakeBrowser.storage.session, 'set');
            const { related } = await setup({
                'titles.related': async () => ({ items: [item('sequel', '1')] }),
            });

            related.open(HOST);
            await vi.waitFor(() => expect(related.screenStatus.value).toBe('data'));
            await flush();
            expect(sessionSet).not.toHaveBeenCalled();
            expect(await fakeBrowser.storage.session.get(null)).toEqual({});
        });

        it('starts a re-opened screen at the first portion again', async () => {
            const items = Array.from({ length: 40 }, (_, index) => item('sequel', String(index)));
            const { related } = await setup({ 'titles.related': async () => ({ items }) });

            related.open(HOST);
            await vi.waitFor(() => expect(related.screenStatus.value).toBe('data'));
            related.loadMore();
            expect(related.shown.value).toBe(40);

            related.close();
            related.open(HOST);
            expect(related.shown.value).toBe(30);
        });
    });

    describe('concurrency', () => {
        it('coalesces a second entry into the request already running', async () => {
            const gate = deferred<{ items: RelatedItem[] }>();
            let calls = 0;
            const { related } = await setup({
                'titles.related': async () => {
                    calls += 1;
                    return gate.promise;
                },
            });

            related.open(HOST);
            await flush();
            related.close();
            related.open(HOST);
            await flush();
            expect(calls).toBe(1);

            gate.resolve({ items: [item('sequel', '1')] });
            await vi.waitFor(() => expect(related.screenStatus.value).toBe('data'));
        });

        it('drops the answer of a title the user has already left', async () => {
            const gate = deferred<{ items: RelatedItem[] }>();
            const { related } = await setup({
                'titles.related': async (payload) =>
                    payload.targetId === HOST.targetId
                        ? gate.promise
                        : { items: [item('prequel', '99')] },
            });

            related.open(HOST); // slow one
            await flush();
            related.open(OTHER_HOST); // the user moved on
            await vi.waitFor(() => expect(related.screenStatus.value).toBe('data'));
            expect(renderedIds(related)).toEqual(['99']);

            gate.resolve({ items: [item('sequel', '1')] });
            await flush();
            // The late answer must not repaint the screen the user is looking at.
            expect(related.target.value).toEqual(OTHER_HOST);
            expect(renderedIds(related)).toEqual(['99']);
        });

        it('keeps the late answer in the cache instead of throwing it away', async () => {
            const gate = deferred<{ items: RelatedItem[] }>();
            let calls = 0;
            const { related } = await setup({
                'titles.related': async (payload) => {
                    calls += 1;
                    return payload.targetId === HOST.targetId
                        ? gate.promise
                        : { items: [item('prequel', '99')] };
                },
            });

            related.open(HOST);
            await flush();
            related.open(OTHER_HOST);
            await vi.waitFor(() => expect(related.screenStatus.value).toBe('data'));
            gate.resolve({ items: [item('sequel', '1')] });
            await flush();

            related.open(HOST);
            expect(related.screenStatus.value).toBe('data');
            expect(renderedIds(related)).toEqual(['1']);
            expect(calls).toBe(2); // the paid-for answer was not re-requested
        });
    });

    describe('poster backfill', () => {
        it('asks one batch per media and patches the rows in', async () => {
            const asked: { type: string; ids: string[] }[] = [];
            const { related } = await setup({
                'titles.related': async () => ({
                    items: [
                        item('sequel', '1'),
                        item('adaptation', '2', { targetType: 'Manga', kind: 'manga' }),
                        item('adaptation', '3', { targetType: 'Manga', kind: 'light_novel' }),
                    ],
                }),
                'posters.fetch': async ({ type, ids }) => {
                    asked.push({ type, ids });
                    return { posters: { [ids[0]]: `https://shikimori.io/${type}.jpg` } };
                },
            });

            related.open(HOST);
            await vi.waitFor(() => expect(related.screenStatus.value).toBe('data'));
            await vi.waitFor(() => expect(asked).toHaveLength(3));
            expect(asked.map((call) => call.type).sort()).toEqual(['anime', 'manga', 'ranobe']);

            await vi.waitFor(() => expect(renderedIds(related).length).toBe(3));
            const posters = related.groups.value
                .flatMap((group) => group.items)
                .map((row) => row.card.posterUrl);
            expect(posters).toEqual([
                'https://shikimori.io/anime.jpg',
                'https://shikimori.io/manga.jpg',
                'https://shikimori.io/ranobe.jpg',
            ]);
        });

        it('says nothing when the backfill fails', async () => {
            const { related, toasts } = await setup({
                'titles.related': async () => ({ items: [item('sequel', '1')] }),
                'posters.fetch': async () => {
                    throw { kind: 'network' } satisfies ApiError;
                },
            });

            related.open(HOST);
            await vi.waitFor(() => expect(related.screenStatus.value).toBe('data'));
            await flush();
            expect(related.screenStatus.value).toBe('data'); // not an error state
            expect(toasts).toEqual([]); // not a user action
            expect(related.groups.value[0].items[0].card.posterUrl).toBeNull();
        });

        it('asks for nothing when every poster is already there', async () => {
            let calls = 0;
            const { related } = await setup({
                'titles.related': async () => ({
                    items: [item('sequel', '1', { posterUrl: 'https://shikimori.io/1.webp' })],
                }),
                'posters.fetch': async () => {
                    calls += 1;
                    return { posters: {} };
                },
            });

            related.open(HOST);
            await vi.waitFor(() => expect(related.screenStatus.value).toBe('data'));
            await flush();
            expect(calls).toBe(0);
        });

        it('keeps the backfilled posters when the title is re-opened', async () => {
            let posterCalls = 0;
            const { related } = await setup({
                'titles.related': async () => ({ items: [item('sequel', '1')] }),
                'posters.fetch': async () => {
                    posterCalls += 1;
                    return { posters: { '1': 'https://shikimori.io/1.jpg' } };
                },
            });

            related.open(HOST);
            await vi.waitFor(() =>
                expect(related.groups.value[0]?.items[0].card.posterUrl).toBe(
                    'https://shikimori.io/1.jpg',
                ),
            );
            related.close();
            related.open(HOST);
            await flush();
            expect(related.groups.value[0].items[0].card.posterUrl).toBe(
                'https://shikimori.io/1.jpg',
            );
            expect(posterCalls).toBe(1);
        });
    });

    describe('portioned rendering', () => {
        // One Piece: 92 links, of which one group is longer than a portion.
        const bigAnswer = (): { items: RelatedItem[] } => ({
            items: [
                ...Array.from({ length: 35 }, (_, index) => item('side_story', `s${index}`)),
                ...Array.from({ length: 57 }, (_, index) => item('summary', `m${index}`)),
            ],
        });

        it('renders the first 30 rows and counts the rest', async () => {
            const { related } = await setup({ 'titles.related': async () => bigAnswer() });

            related.open(HOST);
            await vi.waitFor(() => expect(related.screenStatus.value).toBe('data'));
            expect(related.shown.value).toBe(30);
            expect(related.total.value).toBe(92);
            expect(related.hasMore.value).toBe(true);
            expect(renderedIds(related)).toHaveLength(30);
            // Rows are cut, not groups: only the first group is on screen, and
            // only partly.
            expect(related.groups.value.map((group) => group.kind)).toEqual(['side_story']);
        });

        it('keeps the whole group next to the rendered portion', async () => {
            const { related } = await setup({ 'titles.related': async () => bigAnswer() });

            related.open(HOST);
            await vi.waitFor(() => expect(related.screenStatus.value).toBe('data'));
            // The heading counter and the adaptation heading rule both read
            // `all`, never the portion (i18n.relationGroupLabel).
            expect(related.groups.value[0].items).toHaveLength(30);
            expect(related.groups.value[0].all).toHaveLength(35);
        });

        it('unrolls the tail of a group under the same heading', async () => {
            const { related } = await setup({ 'titles.related': async () => bigAnswer() });

            related.open(HOST);
            await vi.waitFor(() => expect(related.screenStatus.value).toBe('data'));
            related.loadMore();

            expect(related.shown.value).toBe(60);
            expect(renderedIds(related)).toHaveLength(60);
            expect(related.groups.value.map((group) => group.kind)).toEqual([
                'side_story',
                'summary',
            ]);
            expect(related.groups.value[0].items).toHaveLength(35);
            expect(related.groups.value[1].items).toHaveLength(25);
        });

        it('stops at the last row', async () => {
            const { related } = await setup({ 'titles.related': async () => bigAnswer() });

            related.open(HOST);
            await vi.waitFor(() => expect(related.screenStatus.value).toBe('data'));
            related.loadMore();
            related.loadMore();
            related.loadMore(); // 30 + 30 + 30 + 30 covers the 92nd row

            expect(related.shown.value).toBe(92);
            expect(related.hasMore.value).toBe(false);
            expect(renderedIds(related)).toHaveLength(92);

            related.loadMore(); // nothing left to unroll
            expect(related.shown.value).toBe(92);
        });

        it('sends no request for a portion — the answer came whole', async () => {
            let calls = 0;
            const { related } = await setup({
                'titles.related': async () => {
                    calls += 1;
                    return bigAnswer();
                },
            });

            related.open(HOST);
            await vi.waitFor(() => expect(related.screenStatus.value).toBe('data'));
            related.loadMore();
            await flush();
            expect(calls).toBe(1);
        });
    });

    describe('rate writes', () => {
        it('adds a title to the list and keeps it after leaving the screen', async () => {
            const { related } = await setup({
                'titles.related': async () => ({ items: [item('sequel', '1')] }),
                'rates.create': async () => ({ rate: { id: '500', status: 'planned' } }),
            });

            related.open(HOST);
            await vi.waitFor(() => expect(related.screenStatus.value).toBe('data'));
            related.onSetStatus(related.groups.value[0].items[0].card, 'planned');
            await vi.waitFor(() =>
                expect(related.groups.value[0].items[0].card.userRate).toEqual({
                    id: '500',
                    status: 'planned',
                }),
            );

            related.close();
            related.open(HOST);
            // The cached rows and the screen are one array: the badge cannot go
            // stale between two entries of the same session.
            expect(related.groups.value[0].items[0].card.userRate).toEqual({
                id: '500',
                status: 'planned',
            });
        });

        it('rolls back and toasts a failed write', async () => {
            const { related, toasts } = await setup({
                'titles.related': async () => ({ items: [item('sequel', '1')] }),
                'rates.create': async () => {
                    throw { kind: 'network' } satisfies ApiError;
                },
            });

            related.open(HOST);
            await vi.waitFor(() => expect(related.screenStatus.value).toBe('data'));
            related.onSetStatus(related.groups.value[0].items[0].card, 'planned');
            await vi.waitFor(() => expect(toasts).toEqual([i18n.errors.network]));
            expect(related.groups.value[0].items[0].card.userRate).toBeNull();
        });
    });
});
