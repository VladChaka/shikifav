import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import background from '@/entrypoints/background';
import { trackEvent } from './api/analytics';
import { ensureToken, logout } from './api/auth';
import { ONGOING_LIMIT } from './api/graphql';
import { GA4_API_SECRET, GA4_MEASUREMENT_ID } from './config';
import { rateLimiter, setTokenProvider } from './api/http';
import type { RawPollAnime } from './api/graphql';
import type { User } from './api/types';
import { showAiredBacklog } from './badge';
import { AIRED_NOTIFICATION_PREFIX } from './episode-notifications';
import { sendMessage } from './messaging';
import {
    EPISODE_WATCH_ALARM,
    EPISODE_WATCH_FIRST_DELAY_MINUTES,
    EPISODE_WATCH_PERIOD_MINUTES,
    forgetEpisodeWatchTick,
    isEpisodeWatchAlarm,
    runEpisodeWatchTick,
    syncEpisodeWatchAlarm,
} from './episode-watch';
import {
    getAiredSnapshot,
    getBadgeBacklog,
    getLocal,
    getSession,
    removeLocal,
    setAiredSnapshot,
    setLocal,
    setSettings,
} from './storage';
import type { AiredPollItem } from './api/types';
import type { LocalState } from './storage';

// Ф11-7. Two promises of the DoD are the point of this file: a logged-out
// profile makes ZERO background requests, and a switched-off feature has no
// alarm at all. Everything is driven through a mocked global fetch rather than a
// mocked graphql module, so "no request" means literally no request.

// The one exception to that: the poll function is wrapped in a spy that keeps
// calling the real implementation. Without it «нет auth → ни одного запроса»
// would pass with the guard deleted — ensureToken throws before the first fetch
// anyway — and would be testing the platform instead of the guard (ревью Ф11-7).
const { pollSpy } = vi.hoisted(() => ({
    pollSpy: vi.fn<() => Promise<AiredPollItem[]>>(),
}));
vi.mock('./api/graphql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./api/graphql')>();
    pollSpy.mockImplementation(actual.pollAiredAnimes);
    return { ...actual, pollAiredAnimes: pollSpy };
});

const fetchMock = vi.fn<typeof fetch>();
const debug = vi.spyOn(console, 'debug');

const testUser: User = { id: 7, nickname: 'tester', avatarUrl: '' };

function storedAuth(expiresAt = Date.now() + 60 * 60 * 1000): NonNullable<LocalState['auth']> {
    return {
        accessToken: 'stored-access',
        refreshToken: 'stored-refresh',
        expiresAt,
        user: testUser,
    };
}

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status });
}

function pollRow(id: number, episodesAired: number, progress: number): RawPollAnime {
    return {
        id: String(id),
        name: `Ongoing ${id}`,
        russian: null,
        episodesAired,
        url: `https://shikimori.io/animes/${id}-ongoing-${id}`,
        userRate: { id: String(1000 + id), episodes: progress },
    };
}

function mockPollAnswer(...rows: RawPollAnime[]): void {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { animes: rows } }));
}

function graphqlCalls(): number {
    return fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').length;
}

function analyticsCalls(): number {
    return fetchMock.mock.calls.filter(([input]) => String(input).includes('google-analytics.com'))
        .length;
}

// A checkout without a GA4 property turns trackEvent into a documented no-op
// (src/lib/api/analytics.ts), so «ни одного запроса в GA4» would hold there for
// a reason that has nothing to do with the tick. Same guard analytics.test.ts
// uses, and for the same reason: an assertion that cannot fail is not one.
const analyticsConfigured = GA4_MEASUREMENT_ID !== '' && GA4_API_SECRET !== '';
const whenAnalyticsConfigured = analyticsConfigured ? it : it.skip;

function badgeText(): Promise<string> {
    return fakeBrowser.action.getBadgeText({});
}

// Spies that must not outlive their test: fakeBrowser.reset() does not undo
// them, and a permission left granted would silently change what a later test
// is about.
const perTestSpies: { mockRestore: () => void }[] = [];

function track<T extends { mockRestore: () => void }>(spy: T): T {
    perTestSpies.push(spy);
    return spy;
}

// fakeBrowser throws on the whole permissions surface, so the grant is stated
// per test; without this call the tick reads «разрешения нет» and shows nothing.
function grantNotifications(): void {
    track(vi.spyOn(fakeBrowser.permissions, 'contains')).mockResolvedValue(true as never);
}

beforeEach(async () => {
    fakeBrowser.reset();
    // mockClear, never mockReset: the implementation set when the module mock
    // was built is the real poll, and it must survive between tests.
    pollSpy.mockClear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    // Mirrors the registration in entrypoints/background.ts.
    setTokenProvider(ensureToken);
    rateLimiter.reset();
    // fake-browser has no contextMenus implementation, and background.main()
    // subscribes to onClicked synchronously — stub it out (Ф5-7).
    vi.spyOn(fakeBrowser.contextMenus.onClicked, 'addListener').mockImplementation(() => {});
    debug.mockReset();
    debug.mockImplementation(() => {});
    // Ф11-13. trackEvent reads the extension version out of the manifest before
    // it sends anything, and fakeBrowser ships no manifest — so without this the
    // send throws on its way to fetch and is swallowed by design. The Ф11-12
    // promise («фоновый тик ничего не измеряет») would then hold in this file no
    // matter what the tick did: мутационная проверка added a trackEvent to the
    // tick and the suite stayed green. The canary below guards the guard.
    track(vi.spyOn(fakeBrowser.runtime, 'getManifest')).mockReturnValue({
        version: '1.0.0',
    } as ReturnType<typeof fakeBrowser.runtime.getManifest>);
    // Every test but the "switched off" ones runs with the documented default.
    await setSettings({ episodeWatch: true });
});

afterEach(() => {
    vi.unstubAllGlobals();
    for (const spy of perTestSpies.splice(0)) {
        spy.mockRestore();
    }
});

describe('syncEpisodeWatchAlarm', () => {
    // Ф11 audit: an anonymous profile gets no alarm at all, so every case about
    // having one starts from a session.
    beforeEach(async () => {
        await setLocal('auth', storedAuth());
    });

    it('creates one periodic alarm on the documented period', async () => {
        await syncEpisodeWatchAlarm();

        const alarm = await fakeBrowser.alarms.get(EPISODE_WATCH_ALARM);
        expect(alarm?.periodInMinutes).toBe(EPISODE_WATCH_PERIOD_MINUTES);
        expect(EPISODE_WATCH_PERIOD_MINUTES).toBe(30);
        expect(await fakeBrowser.alarms.getAll()).toHaveLength(1);
    });

    // The first tick comes sooner than a full period because an alarm does not
    // survive an extension update: without it an updated profile would wait half
    // an hour for its first badge.
    it('schedules the first tick ahead of the period', async () => {
        const before = Date.now();

        await syncEpisodeWatchAlarm();

        const alarm = await fakeBrowser.alarms.get(EPISODE_WATCH_ALARM);
        expect(alarm?.scheduledTime).toBeLessThanOrEqual(
            before + EPISODE_WATCH_FIRST_DELAY_MINUTES * 60_000 + 1_000,
        );
        // Chrome ignores anything under half a minute (and warns about it).
        expect(EPISODE_WATCH_FIRST_DELAY_MINUTES).toBeGreaterThanOrEqual(0.5);
    });

    // Ф11-13, мутационная проверка. The case above states the deadline in terms
    // of the constant itself, so raising the constant to a full period — exactly
    // the regression the short first delay exists to prevent (an alarm does not
    // survive an extension update, and the updated profile would sit without a
    // badge for half an hour) — left it green. The gap is what matters, so the
    // gap is what is asserted.
    it('schedules the first tick strictly sooner than a full period', async () => {
        const before = Date.now();

        await syncEpisodeWatchAlarm();

        expect(EPISODE_WATCH_FIRST_DELAY_MINUTES).toBeLessThan(EPISODE_WATCH_PERIOD_MINUTES);
        const alarm = await fakeBrowser.alarms.get(EPISODE_WATCH_ALARM);
        expect(alarm?.scheduledTime).toBeLessThan(before + EPISODE_WATCH_PERIOD_MINUTES * 60_000);
    });

    // Called on install AND on every browser start, so it must never end up with
    // two alarms — and must not reset the schedule of the one already ticking.
    it('is idempotent: a second call neither duplicates nor reschedules', async () => {
        await syncEpisodeWatchAlarm();
        const first = await fakeBrowser.alarms.get(EPISODE_WATCH_ALARM);
        const create = vi.spyOn(fakeBrowser.alarms, 'create');

        await syncEpisodeWatchAlarm();

        expect(create).not.toHaveBeenCalled();
        expect(await fakeBrowser.alarms.getAll()).toHaveLength(1);
        expect((await fakeBrowser.alarms.get(EPISODE_WATCH_ALARM))?.scheduledTime).toBe(
            first?.scheduledTime,
        );
        create.mockRestore();
    });

    it('removes the alarm when the feature is switched off', async () => {
        await syncEpisodeWatchAlarm();
        await setSettings({ episodeWatch: false });

        await syncEpisodeWatchAlarm();

        expect(await fakeBrowser.alarms.get(EPISODE_WATCH_ALARM)).toBeUndefined();
        expect(await fakeBrowser.alarms.getAll()).toHaveLength(0);
    });

    // The counter belongs to the feature: switched off, it must not keep a
    // number on the icon that nothing updates any more.
    it('wipes the badge when the feature is switched off', async () => {
        await showAiredBacklog([{ rateId: '1', episodesAired: 8, progress: 3 }]);
        await setSettings({ episodeWatch: false });

        await syncEpisodeWatchAlarm();

        expect(await badgeText()).toBe('');
        await expect(getBadgeBacklog()).resolves.toEqual([]);
    });

    it('creates no alarm at all while the feature is off', async () => {
        await setSettings({ episodeWatch: false });

        await syncEpisodeWatchAlarm();

        expect(await fakeBrowser.alarms.getAll()).toHaveLength(0);
    });

    // Ф11 audit. The snapshot is a map «тайтл → сколько серий вышло» of the
    // user's lists: left behind by a switched-off feature it would sit in
    // storage.local indefinitely, and the day the feature came back the diff
    // would run against a snapshot from weeks ago and fire a burst at once.
    it('drops the airing snapshot when the feature is switched off', async () => {
        await setAiredSnapshot({ '1': 8, '2': 3 });
        await setSettings({ episodeWatch: false });

        await syncEpisodeWatchAlarm();

        await expect(getAiredSnapshot()).resolves.toEqual({});
    });

    // The messages already in the tray carry the names of those titles.
    it('takes its notifications out of the tray when the feature is switched off', async () => {
        grantNotifications();
        await fakeBrowser.notifications.create(`${AIRED_NOTIFICATION_PREFIX}1`, {
            type: 'basic',
            iconUrl: '/icon/128.png',
            title: 'Ongoing 1',
            message: 'Вышла 9 серия',
        });
        await setSettings({ episodeWatch: false });

        await syncEpisodeWatchAlarm();

        expect(await fakeBrowser.notifications.getAll()).toEqual({});
    });

    // Ф11 audit. An alarm on a profile that never logged in wakes the service
    // worker every half hour for a tick that leaves on its own auth guard —
    // forever, and for nothing.
    it('creates no alarm for a profile with no session', async () => {
        await removeLocal('auth');

        await syncEpisodeWatchAlarm();

        expect(await fakeBrowser.alarms.getAll()).toHaveLength(0);
    });

    it('removes the alarm left behind by a session that ended', async () => {
        await syncEpisodeWatchAlarm();
        expect(await fakeBrowser.alarms.get(EPISODE_WATCH_ALARM)).toBeDefined();

        await removeLocal('auth');
        await syncEpisodeWatchAlarm();

        expect(await fakeBrowser.alarms.getAll()).toHaveLength(0);
    });

    it('never rejects when the alarms API fails', async () => {
        const create = vi.spyOn(fakeBrowser.alarms, 'create').mockImplementation(() => {
            throw new Error('no alarms api');
        });

        await expect(syncEpisodeWatchAlarm()).resolves.toBeUndefined();
        expect(debug).toHaveBeenCalled();
        create.mockRestore();
    });
});

describe('isEpisodeWatchAlarm', () => {
    it('answers only for our own alarm', () => {
        expect(isEpisodeWatchAlarm({ name: EPISODE_WATCH_ALARM })).toBe(true);
        expect(isEpisodeWatchAlarm({ name: 'someone-else' })).toBe(false);
    });
});

describe('runEpisodeWatchTick', () => {
    // The DoD, literally: a logged-out profile costs Shikimori nothing. Without
    // the guard every half hour would be a refused request, and an expired token
    // a refresh on top of it. The poll spy is what pins the GUARD rather than the
    // platform: ensureToken would throw before any fetch even with the guard
    // gone, so «fetch не вызывался» alone proves nothing (ревью Ф11-7).
    it('makes no request at all without auth', async () => {
        await runEpisodeWatchTick();

        expect(pollSpy).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('wipes a badge left over from a session that is gone', async () => {
        await showAiredBacklog([{ rateId: '1', episodesAired: 8, progress: 3 }]);

        await runEpisodeWatchTick();

        expect(await badgeText()).toBe('');
    });

    // The second half of the same DoD line: a switched-off feature makes no
    // request either — and repairs the alarm a sleeping worker missed the news
    // about.
    it('makes no request and removes the alarm when the feature is off', async () => {
        await setLocal('auth', storedAuth());
        await syncEpisodeWatchAlarm();
        await setSettings({ episodeWatch: false });

        await runEpisodeWatchTick();

        expect(pollSpy).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(await fakeBrowser.alarms.get(EPISODE_WATCH_ALARM)).toBeUndefined();
    });

    it('polls once and puts the titles behind on the badge', async () => {
        await setLocal('auth', storedAuth());
        mockPollAnswer(pollRow(1, 8, 3), pollRow(2, 12, 12), pollRow(3, 4, 3));

        await runEpisodeWatchTick();

        expect(graphqlCalls()).toBe(1);
        expect(await badgeText()).toBe('2');
        await expect(getBadgeBacklog()).resolves.toEqual([
            { rateId: '1001', episodesAired: 8, progress: 3 },
            { rateId: '1002', episodesAired: 12, progress: 12 },
            { rateId: '1003', episodesAired: 4, progress: 3 },
        ]);
    });

    it('seeds the airing snapshot from the answer', async () => {
        await setLocal('auth', storedAuth());
        mockPollAnswer(pollRow(1, 8, 3), pollRow(2, 12, 12));

        await runEpisodeWatchTick();

        await expect(getAiredSnapshot()).resolves.toEqual({ '1': 8, '2': 12 });
    });

    // «Два тика подряд не должны портить снимок»: the second run over the same
    // answer must leave exactly the same state behind.
    it('is idempotent across two ticks over the same answer', async () => {
        await setLocal('auth', storedAuth());
        mockPollAnswer(pollRow(1, 8, 3));
        await runEpisodeWatchTick();
        mockPollAnswer(pollRow(1, 8, 3));

        await runEpisodeWatchTick();

        await expect(getAiredSnapshot()).resolves.toEqual({ '1': 8 });
        expect(await badgeText()).toBe('1');
    });

    it('follows the counter forward on the next tick', async () => {
        await setLocal('auth', storedAuth());
        mockPollAnswer(pollRow(1, 8, 8));
        await runEpisodeWatchTick();
        expect(await badgeText()).toBe('');
        mockPollAnswer(pollRow(1, 9, 8));

        await runEpisodeWatchTick();

        await expect(getAiredSnapshot()).resolves.toEqual({ '1': 9 });
        expect(await badgeText()).toBe('1');
    });

    // A tick can live for about three minutes (429 retried inside http.ts), so
    // the popup — or a second alarm — must not start a parallel one.
    it('runs one poll for two overlapping calls', async () => {
        await setLocal('auth', storedAuth());
        mockPollAnswer(pollRow(1, 8, 3));

        await Promise.all([runEpisodeWatchTick(), runEpisodeWatchTick()]);

        expect(graphqlCalls()).toBe(1);
    });

    // A login happens while a tick is in flight: that tick is about the lists of
    // the account that just went away, so single-flight must not hand it back as
    // the answer for the new one (ревью Ф11-9).
    it('polls again for a tick abandoned mid-flight', async () => {
        await setLocal('auth', storedAuth());
        let releaseFirst: (response: Response) => void = () => {};
        fetchMock.mockImplementationOnce(
            () =>
                new Promise<Response>((resolve) => {
                    releaseFirst = resolve;
                }),
        );
        const abandoned = runEpisodeWatchTick();

        forgetEpisodeWatchTick();
        mockPollAnswer(pollRow(1, 8, 3));
        await runEpisodeWatchTick();

        expect(graphqlCalls()).toBe(2);
        expect(await badgeText()).toBe('1');
        releaseFirst(jsonResponse(200, { data: { animes: [] } }));
        await abandoned;
    });

    // Ф11 audit. The slot has to remember WHICH run owns it: an unconditional
    // `.finally` cleared whatever was in it, including the tick that had replaced
    // the finishing one, and the next alarm then started a second tick alongside
    // the live one — two ticks diffing the same snapshot, which is exactly what
    // single-flight exists to prevent.
    it('keeps the slot of the tick that replaced an abandoned one', async () => {
        await setLocal('auth', storedAuth());
        const pending: ((response: Response) => void)[] = [];
        fetchMock.mockImplementation(
            () =>
                new Promise<Response>((resolve) => {
                    pending.push(resolve);
                }),
        );
        const abandoned = runEpisodeWatchTick();
        await vi.waitFor(() => expect(pending).toHaveLength(1));

        // A login lands: background.ts forgets the old tick and starts a new one.
        forgetEpisodeWatchTick();
        const current = runEpisodeWatchTick();
        await vi.waitFor(() => expect(pending).toHaveLength(2));
        // The abandoned one lands now; its cleanup must not touch the slot of the
        // tick that is still in the air.
        pending[0]!(jsonResponse(200, { data: { animes: [] } }));
        await abandoned;

        // The alarm fires while the current tick is still polling.
        expect(runEpisodeWatchTick()).toBe(current);
        pending[1]!(jsonResponse(200, { data: { animes: [] } }));
        await current;
    });

    it('lets a later tick run after the previous one has settled', async () => {
        await setLocal('auth', storedAuth());
        mockPollAnswer(pollRow(1, 8, 3));
        await runEpisodeWatchTick();
        mockPollAnswer(pollRow(1, 9, 3));

        await runEpisodeWatchTick();

        expect(graphqlCalls()).toBe(2);
    });

    it('asks for the poll page size the read layer owns', async () => {
        await setLocal('auth', storedAuth());
        mockPollAnswer();

        await runEpisodeWatchTick();

        const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as {
            query: string;
            variables: { limit: number; page: number };
        };
        expect(body.query).toContain('query PollAiredAnimes');
        expect(body.variables).toEqual({ limit: ONGOING_LIMIT, page: 1 });
    });

    // Nothing airing is a legal answer, and it must wipe the previous number.
    it('clears the badge on an empty answer', async () => {
        await setLocal('auth', storedAuth());
        await showAiredBacklog([{ rateId: '1', episodesAired: 8, progress: 3 }]);
        mockPollAnswer();

        await runEpisodeWatchTick();

        expect(await badgeText()).toBe('');
    });

    // The risk phase 11 had to close in code: a refresh that fails inside the
    // tick clears auth, and the icon must not keep a number of a session that no
    // longer exists — there is no frame on screen to explain it.
    it('wipes the badge when the session is lost inside the tick', async () => {
        await setLocal('auth', storedAuth(Date.now() - 1_000));
        await showAiredBacklog([{ rateId: '1', episodesAired: 8, progress: 3 }]);
        // The refresh answers 401 -> the session is gone (docs/04 §3.5).
        fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'invalid_grant' }));

        await runEpisodeWatchTick();

        expect(await badgeText()).toBe('');
        await expect(getBadgeBacklog()).resolves.toEqual([]);
    });

    // A tick that did not happen is not a reason to change anything on screen:
    // the badge keeps its last known number and the next alarm tries again.
    it('keeps the last number when the poll fails', async () => {
        await setLocal('auth', storedAuth());
        await showAiredBacklog([{ rateId: '1', episodesAired: 8, progress: 3 }]);
        await setAiredSnapshot({ '1': 8 });
        fetchMock.mockRejectedValueOnce(new TypeError('offline'));

        await expect(runEpisodeWatchTick()).resolves.toBeUndefined();

        expect(await badgeText()).toBe('1');
        await expect(getAiredSnapshot()).resolves.toEqual({ '1': 8 });
    });

    // Ф11-10. The half of the tick that talks to the user: an increase found by
    // the diff becomes exactly one system notification, gated by the setting and
    // by the Chrome permission (both checked in detail in
    // episode-notifications.test.ts).
    describe('notifications', () => {
        function notifications(): Promise<Record<string, { title?: string; message?: string }>> {
            return fakeBrowser.notifications.getAll() as unknown as Promise<
                Record<string, { title?: string; message?: string }>
            >;
        }

        it('notifies about the episode the diff found', async () => {
            grantNotifications();
            await setLocal('auth', storedAuth());
            await setAiredSnapshot({ '1': 8 });
            mockPollAnswer(pollRow(1, 9, 3));

            await runEpisodeWatchTick();

            expect(await notifications()).toEqual({
                'shikifav-aired:1': expect.objectContaining({
                    title: 'Ongoing 1',
                    message: 'Вышла 9 серия',
                }),
            });
        });

        // The silent seed of the snapshot, seen from the outside: a title just
        // added to a list arrives with everything that has already aired, and it
        // must not fire one message per episode (docs/06, «Известное
        // ограничение»).
        it('says nothing about a title the snapshot has never seen', async () => {
            grantNotifications();
            await setLocal('auth', storedAuth());
            mockPollAnswer(pollRow(1, 12, 0), pollRow(2, 3, 0));

            await runEpisodeWatchTick();

            expect(await notifications()).toEqual({});
            // Seeded, though: the NEXT episode is an event.
            await expect(getAiredSnapshot()).resolves.toEqual({ '1': 12, '2': 3 });
        });

        it('stays silent when notifications are switched off', async () => {
            grantNotifications();
            await setSettings({ episodeNotifications: false });
            await setLocal('auth', storedAuth());
            await setAiredSnapshot({ '1': 8 });
            mockPollAnswer(pollRow(1, 9, 3));

            await runEpisodeWatchTick();

            expect(await notifications()).toEqual({});
            // The counter is not what was switched off (owner's decision 6).
            expect(await badgeText()).toBe('1');
        });

        // A notification that fails must not cost the advance of the snapshot:
        // otherwise the same episode would be reported at every tick forever.
        it('keeps the snapshot and the badge when the notification fails', async () => {
            grantNotifications();
            track(vi.spyOn(fakeBrowser.notifications, 'create')).mockRejectedValue(
                new Error('no notifications api'),
            );
            await setLocal('auth', storedAuth());
            await setAiredSnapshot({ '1': 8 });
            mockPollAnswer(pollRow(1, 9, 3));

            await expect(runEpisodeWatchTick()).resolves.toBeUndefined();

            await expect(getAiredSnapshot()).resolves.toEqual({ '1': 9 });
            expect(await badgeText()).toBe('1');
        });
    });

    // Ф11 audit. The fence used to be ONE check standing before three awaits in
    // a row (snapshot → badge → notifications), so a logout landing between them
    // still got the writes and the messages of the session it had just ended.
    // Every write and the notification now ask again, immediately before acting.
    describe('the epoch fence', () => {
        // Parks the tick inside the first storage write that carries `key`, so
        // the session can end at a point the old single check was already past.
        function parkOnWrite(key: string): { hit: () => boolean; release: () => void } {
            const realSet = fakeBrowser.storage.local.set.bind(fakeBrowser.storage.local);
            let release: (() => void) | undefined;
            let hit = false;
            track(vi.spyOn(fakeBrowser.storage.local, 'set')).mockImplementation((async (
                items: Record<string, unknown>,
            ) => {
                if (!hit && key in items) {
                    hit = true;
                    await new Promise<void>((resolve) => {
                        release = resolve;
                    });
                }
                return realSet(items);
            }) as never);
            return { hit: () => hit, release: () => release?.() };
        }

        it('draws no badge and says nothing after a logout lands mid-tick', async () => {
            grantNotifications();
            await setLocal('auth', storedAuth());
            await setAiredSnapshot({ '1': 8 });
            mockPollAnswer(pollRow(1, 9, 3));
            const parked = parkOnWrite('airedSnapshot');

            const tick = runEpisodeWatchTick();
            await vi.waitFor(() => expect(parked.hit()).toBe(true));
            // «Выйти» right now: the session, its snapshot and its badge are gone.
            await logout();
            parked.release();
            await tick;

            // The badge row and the notification belong to a session that is
            // over — neither may appear.
            await expect(getBadgeBacklog()).resolves.toEqual([]);
            expect(await badgeText()).toBe('');
            expect(await fakeBrowser.notifications.getAll()).toEqual({});
        });

        // The residual race the fence alone does NOT close (найдено ревью). The
        // snapshot write of this very test was already dispatched when the logout
        // happened, and nothing can recall a call in flight: it lands AFTER
        // clearAuth() removed the key, and a map of somebody's lists then
        // outlives their session in storage.local until the next tick or login.
        // So the tick asks once more after its own write and takes it back.
        it('takes its snapshot back when the write landed after a logout', async () => {
            await setLocal('auth', storedAuth());
            await setAiredSnapshot({ '1': 8 });
            mockPollAnswer(pollRow(1, 9, 3));
            const parked = parkOnWrite('airedSnapshot');

            const tick = runEpisodeWatchTick();
            await vi.waitFor(() => expect(parked.hit()).toBe(true));
            await logout();
            parked.release();
            await tick;

            await expect(getAiredSnapshot()).resolves.toEqual({});
            await expect(getLocal('airedSnapshot')).resolves.toBeUndefined();
        });

        it('says nothing after a logout lands between the badge and the message', async () => {
            grantNotifications();
            await setLocal('auth', storedAuth());
            await setAiredSnapshot({ '1': 8 });
            mockPollAnswer(pollRow(1, 9, 3));
            const parked = parkOnWrite('badgeBacklog');

            const tick = runEpisodeWatchTick();
            await vi.waitFor(() => expect(parked.hit()).toBe(true));
            await logout();
            parked.release();
            await tick;

            // A notification is I/O to the outside world: once the system has it,
            // no order of storage writes can take it back.
            expect(await fakeBrowser.notifications.getAll()).toEqual({});
        });

        // Найдено ревью, and reproduced here from the outside: the fence stood
        // BEFORE notifyAiredEpisodes, while inside it there were two more awaits
        // (the setting and the permission) and a loop of up to three create()
        // calls. A logout landing in that window ran clearAiredNotifications()
        // before the messages existed, so the tray kept `shikifav-aired:<id>` of
        // a finished session and storage.session kept its address.
        it('shows no further message after a logout lands between two messages', async () => {
            grantNotifications();
            await setLocal('auth', storedAuth());
            await setAiredSnapshot({ '1': 8, '2': 3 });
            mockPollAnswer(pollRow(1, 9, 3), pollRow(2, 4, 1));
            const realCreate = fakeBrowser.notifications.create.bind(fakeBrowser.notifications);
            let releaseFirst: (() => void) | undefined;
            let parked = false;
            const create = track(vi.spyOn(fakeBrowser.notifications, 'create'));
            create.mockImplementation((async (id: string, options: unknown) => {
                if (!parked) {
                    parked = true;
                    await new Promise<void>((resolve) => {
                        releaseFirst = resolve;
                    });
                }
                return realCreate(id, options as never);
            }) as never);

            const tick = runEpisodeWatchTick();
            await vi.waitFor(() => expect(parked).toBe(true));
            await logout();
            releaseFirst?.();
            await tick;

            // The first message was already on its way when the session ended
            // and nothing can recall it — that one is the accepted residual. The
            // SECOND must never appear, and no address of either may be stored.
            expect(create).toHaveBeenCalledTimes(1);
            expect(Object.keys(await fakeBrowser.notifications.getAll())).toEqual([
                `${AIRED_NOTIFICATION_PREFIX}1`,
            ]);
            await expect(getSession('airedNotificationUrls')).resolves.toBeUndefined();
        });

        // The same window, with the switch instead of the session: turning the
        // feature off while a poll was in the air used to leave the number of
        // that poll frozen on the icon, because syncEpisodeWatchAlarm() had
        // already wiped the badge before the tick landed.
        it('writes nothing when the feature is switched off mid-poll', async () => {
            grantNotifications();
            await setLocal('auth', storedAuth());
            await setAiredSnapshot({ '1': 8 });
            let releasePoll: (response: Response) => void = () => {};
            fetchMock.mockImplementationOnce(
                () =>
                    new Promise<Response>((resolve) => {
                        releasePoll = resolve;
                    }),
            );

            const tick = runEpisodeWatchTick();
            await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
            await setSettings({ episodeWatch: false });
            releasePoll(jsonResponse(200, { data: { animes: [pollRow(1, 9, 3)] } }));
            await tick;

            expect(await badgeText()).toBe('');
            await expect(getBadgeBacklog()).resolves.toEqual([]);
            expect(await fakeBrowser.notifications.getAll()).toEqual({});
        });
    });

    // Ф11-12: no measurement on a background tick. A logged-out or offline
    // profile would otherwise report an `api_failed` every half hour, which
    // PRIVACY.md does not promise.
    describe('no measurement on the tick', () => {
        // THE CANARY (Ф11-13). Everything below asserts that no request reached
        // GA4, and such an assertion is worth exactly as much as the setup that
        // would let one through. This test is the setup, checked: the same
        // fetch stub, the same manifest mock, one event sent by hand.
        whenAnalyticsConfigured('would see an analytics request if the tick made one', async () => {
            await trackEvent({ name: 'calendar_opened', params: {} });

            expect(analyticsCalls()).toBe(1);
        });

        it('reports nothing to analytics, neither on success nor on failure', async () => {
            await setLocal('auth', storedAuth());
            mockPollAnswer(pollRow(1, 8, 3));
            await runEpisodeWatchTick();
            fetchMock.mockRejectedValueOnce(new TypeError('offline'));
            await runEpisodeWatchTick();

            expect(analyticsCalls()).toBe(0);
        });

        // A tick that leaves on a guard is the case PRIVACY.md is most explicit
        // about: a logged-out or offline profile must not send anything at all,
        // and it is woken up every half hour forever.
        it('reports nothing when the tick leaves on the auth guard', async () => {
            await runEpisodeWatchTick();

            expect(analyticsCalls()).toBe(0);
        });

        // Through the wiring, not the exported function: measurement in this
        // project is bolted onto handlers in entrypoints/background.ts, so the
        // listener that runs the tick is where it would most plausibly be added
        // by mistake — and the direct calls above cannot see that at all.
        it('reports nothing when the tick is started by its alarm', async () => {
            background.main();
            await setLocal('auth', storedAuth());
            mockPollAnswer(pollRow(1, 8, 3));

            await fakeBrowser.alarms.onAlarm.trigger({
                name: EPISODE_WATCH_ALARM,
                scheduledTime: 0,
                periodInMinutes: EPISODE_WATCH_PERIOD_MINUTES,
            });
            await vi.waitFor(() => expect(graphqlCalls()).toBe(1));

            expect(analyticsCalls()).toBe(0);
        });
    });
});

describe('background wiring', () => {
    it('subscribes to onAlarm synchronously, before any await', () => {
        const addListener = vi.spyOn(fakeBrowser.alarms.onAlarm, 'addListener');

        background.main();

        expect(addListener).toHaveBeenCalledTimes(1);
        addListener.mockRestore();
    });

    it('ignores an alarm that is not ours', async () => {
        background.main();
        await setLocal('auth', storedAuth());

        await fakeBrowser.alarms.onAlarm.trigger({ name: 'someone-else', scheduledTime: 0 });

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('runs the tick on our alarm', async () => {
        background.main();
        await setLocal('auth', storedAuth());
        mockPollAnswer(pollRow(1, 8, 3));

        await fakeBrowser.alarms.onAlarm.trigger({
            name: EPISODE_WATCH_ALARM,
            scheduledTime: 0,
            periodInMinutes: EPISODE_WATCH_PERIOD_MINUTES,
        });
        // The listener does not await the tick (an alarm handler must return
        // fast), so the poll is only guaranteed to have STARTED here.
        await vi.waitFor(() => expect(graphqlCalls()).toBe(1));
    });

    // Ревью Ф11-7: the alarm is asked for on EVERY worker start, not only from
    // onInstalled/onStartup. An alarm can go missing without either of them
    // firing — the extension switched off and on again, a Reload on the
    // extensions page, a refused alarms.create() — and nobody would put it back
    // before the next browser restart.
    it('creates the alarm on a plain worker start, with no install or startup event', async () => {
        await setLocal('auth', storedAuth());

        background.main();

        await vi.waitFor(async () =>
            expect(await fakeBrowser.alarms.get(EPISODE_WATCH_ALARM)).toBeDefined(),
        );
    });

    // Ф11 audit, the other half of «нет auth → будильника нет»: the alarm is
    // gone for an anonymous profile, so the login is what has to bring it back —
    // otherwise the first counter of a fresh install would wait for a browser
    // restart.
    it('creates the alarm right after a login', async () => {
        background.main();
        await vi.waitFor(() => expect(fakeBrowser.alarms.getAll()).resolves.toHaveLength(0));
        fakeBrowser.identity.getRedirectURL = (() =>
            'https://ext.test/callback') as typeof fakeBrowser.identity.getRedirectURL;
        fakeBrowser.identity.launchWebAuthFlow = (async () =>
            'https://ext.test/callback?code=auth-code') as typeof fakeBrowser.identity.launchWebAuthFlow;
        fetchMock.mockImplementation(async (input) => {
            const url = String(input);
            if (url.endsWith('/oauth/token')) {
                return jsonResponse(200, {
                    access_token: 'fresh-access',
                    refresh_token: 'fresh-refresh',
                    expires_in: 86_400,
                });
            }
            if (url.endsWith('/api/users/whoami')) {
                return jsonResponse(200, { id: 7, nickname: 'tester', avatar: null });
            }
            return jsonResponse(200, { data: { animes: [] } });
        });

        await sendMessage('auth.login');

        expect(await fakeBrowser.alarms.get(EPISODE_WATCH_ALARM)).toBeDefined();
    });

    // An alarm does not survive an extension update, and the install/startup
    // repeats are the recovery path for a first attempt that was refused.
    it('brings a lost alarm back on browser start', async () => {
        await setLocal('auth', storedAuth());
        background.main();
        await vi.waitFor(async () =>
            expect(await fakeBrowser.alarms.get(EPISODE_WATCH_ALARM)).toBeDefined(),
        );
        await fakeBrowser.alarms.clear(EPISODE_WATCH_ALARM);

        await fakeBrowser.runtime.onStartup.trigger();

        await vi.waitFor(async () =>
            expect(await fakeBrowser.alarms.get(EPISODE_WATCH_ALARM)).toBeDefined(),
        );
    });

    it('brings a lost alarm back on install or update', async () => {
        await setLocal('auth', storedAuth());
        background.main();
        await vi.waitFor(async () =>
            expect(await fakeBrowser.alarms.get(EPISODE_WATCH_ALARM)).toBeDefined(),
        );
        await fakeBrowser.alarms.clear(EPISODE_WATCH_ALARM);

        await fakeBrowser.runtime.onInstalled.trigger({ reason: 'update', temporary: false });

        await vi.waitFor(async () =>
            expect(await fakeBrowser.alarms.get(EPISODE_WATCH_ALARM)).toBeDefined(),
        );
    });

    // The options page writes settings straight to storage, so this is what
    // makes switching the feature off take the alarm down at once.
    it('follows a settings write and removes the alarm', async () => {
        await setLocal('auth', storedAuth());
        background.main();
        await syncEpisodeWatchAlarm();

        await setSettings({ episodeWatch: false });

        await vi.waitFor(async () =>
            expect(await fakeBrowser.alarms.get(EPISODE_WATCH_ALARM)).toBeUndefined(),
        );
    });

    it('follows a settings write and creates the alarm when switched back on', async () => {
        await setLocal('auth', storedAuth());
        await setSettings({ episodeWatch: false });
        background.main();

        await setSettings({ episodeWatch: true });

        await vi.waitFor(async () =>
            expect(await fakeBrowser.alarms.get(EPISODE_WATCH_ALARM)).toBeDefined(),
        );
    });

    // Ф11-10. Same rule as the alarm: a click on a notification wakes the worker
    // up and has to find the handler already attached — and the subscription is
    // wrapped, because on a profile without the optional permission the API is
    // not there to subscribe to.
    it('subscribes to notification clicks on every worker start', async () => {
        grantNotifications();
        await setLocal('auth', storedAuth());
        await setAiredSnapshot({ '1': 8 });
        mockPollAnswer(pollRow(1, 9, 3));
        await runEpisodeWatchTick();
        background.main();
        const create = track(vi.spyOn(fakeBrowser.tabs, 'create'));

        await fakeBrowser.notifications.onClicked.trigger(`${AIRED_NOTIFICATION_PREFIX}1`);

        // Ф11-16: the title page on Shikimori, not the extension.
        await vi.waitFor(() =>
            expect(create).toHaveBeenCalledWith({ url: 'https://shikimori.io/animes/1-ongoing-1' }),
        );
    });

    it('restores the badge on every service worker start, without a request', async () => {
        await showAiredBacklog([{ rateId: '1', episodesAired: 8, progress: 3 }]);
        await fakeBrowser.action.setBadgeText({ text: '' });

        background.main();

        await vi.waitFor(async () => expect(await badgeText()).toBe('1'));
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
