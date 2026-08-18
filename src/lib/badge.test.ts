import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import background from '@/entrypoints/background';
import { ensureToken, logout } from './api/auth';
import { rateLimiter, setTokenProvider } from './api/http';
import type { RateState, User } from './api/types';
import { applyRateWrite, clearBadge, forgetRate, restoreBadge, showAiredBacklog } from './badge';
import type { BadgeRow } from './badge-backlog';
import { badgeTitleMessage } from './i18n';
import { sendMessage } from './messaging';
import { getBadgeBacklog, getLocal, setLocal } from './storage';
import type { LocalState } from './storage';

// Ф11-9. The badge is the only thing this extension shows without being opened,
// so the rules it is pinned against here are about what stays on the icon: never
// a number of a session that is gone, never a number that outlived the write
// that changed it, and never a lie about how big the backlog is.

// fakeBrowser implements the whole action badge API in memory, so the
// assertions read the real state back instead of counting calls — except for the
// two colours, which have no promise-shaped getter.
const setBadgeBackgroundColor = vi.spyOn(fakeBrowser.action, 'setBadgeBackgroundColor');
const setBadgeTextColor = vi.spyOn(fakeBrowser.action, 'setBadgeTextColor');
const setBadgeText = vi.spyOn(fakeBrowser.action, 'setBadgeText');
const debug = vi.spyOn(console, 'debug');

function row(rateId: string, episodesAired: number, progress: number): BadgeRow {
    return { rateId, episodesAired, progress };
}

// Three titles, two of them behind: the count is TITLES, not episodes — the one
// with five unwatched episodes still adds exactly one.
const backlog: BadgeRow[] = [row('1', 8, 3), row('2', 12, 12), row('3', 4, 3)];

function badgeText(): Promise<string> {
    return fakeBrowser.action.getBadgeText({});
}

function badgeTitle(): Promise<string> {
    return fakeBrowser.action.getTitle({});
}

function rate(overrides: Partial<RateState> = {}): RateState {
    return {
        id: '1',
        status: 'watching',
        score: 0,
        episodes: 3,
        chapters: 0,
        volumes: 0,
        ...overrides,
    };
}

beforeEach(() => {
    fakeBrowser.reset();
    setBadgeBackgroundColor.mockClear();
    setBadgeTextColor.mockClear();
    setBadgeText.mockClear();
    debug.mockReset();
    debug.mockImplementation(() => {});
});

describe('showAiredBacklog', () => {
    it('draws the number of titles behind, not the number of episodes', async () => {
        await showAiredBacklog(backlog);

        expect(await badgeText()).toBe('2');
    });

    it('stores the rows so the count survives the service worker', async () => {
        await showAiredBacklog(backlog);

        await expect(getBadgeBacklog()).resolves.toEqual(backlog);
    });

    // The icon carries its own white sheet, so one pair of colours is right for
    // both browser themes — and both are set explicitly, because Chrome's own
    // default badge colour means "error" nowhere in this extension.
    it('sets both colours explicitly on every draw', async () => {
        await showAiredBacklog(backlog);

        expect(setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#1a7f5a' });
        expect(setBadgeTextColor).toHaveBeenCalledWith({ color: '#ffffff' });
    });

    it('names the count in the tooltip, with the right plural', async () => {
        await showAiredBacklog(backlog);
        expect(await badgeTitle()).toBe('ShikiFAV: 2 тайтла с неотмеченными сериями');
    });

    // «Пустой результат» of the DoD: an empty answer is a real state (nothing is
    // airing), and it must wipe the previous number rather than keep it.
    it('clears the badge on an empty poll result', async () => {
        await showAiredBacklog(backlog);
        await showAiredBacklog([]);

        expect(await badgeText()).toBe('');
        expect(await badgeTitle()).toBe('ShikiFAV');
    });

    // The rows are rebuilt from the current answer every tick, like the airing
    // snapshot: a title that left the lists cannot linger in the count.
    it('replaces the stored rows wholesale', async () => {
        await showAiredBacklog(backlog);
        await showAiredBacklog([row('9', 2, 0)]);

        await expect(getBadgeBacklog()).resolves.toEqual([row('9', 2, 0)]);
        expect(await badgeText()).toBe('1');
    });

    it('caps a huge backlog at 99+ while the tooltip keeps the exact number', async () => {
        const many = Array.from({ length: 128 }, (_, i) => row(String(i), 2, 0));

        await showAiredBacklog(many);

        expect(await badgeText()).toBe('99+');
        expect(await badgeTitle()).toBe(badgeTitleMessage(128));
        expect(await badgeTitle()).toContain('128');
    });
});

describe('clearBadge', () => {
    it('wipes the number and the tooltip', async () => {
        await showAiredBacklog(backlog);

        await clearBadge();

        expect(await badgeText()).toBe('');
        expect(await badgeTitle()).toBe('ShikiFAV');
    });

    // A number from a previous account must not be restorable, so the rows go
    // with it — the same rule that sends the airing snapshot away with `auth`.
    it('drops the stored rows so nothing can be restored later', async () => {
        await showAiredBacklog(backlog);

        await clearBadge();

        await expect(getLocal('badgeBacklog')).resolves.toBeUndefined();
        await restoreBadge();
        expect(await badgeText()).toBe('');
    });

    // Ф11 audit. The number is what the user sees, so it goes out FIRST and in a
    // guard of its own: with both steps under one guard, a refused storage delete
    // used to skip the redraw entirely and leave the count of a session that is
    // over sitting on the icon.
    it('shows zero even when the stored rows cannot be deleted', async () => {
        await showAiredBacklog(backlog);
        const remove = vi
            .spyOn(fakeBrowser.storage.local, 'remove')
            .mockRejectedValue(new Error('storage gone'));
        // fakeBrowser.reset() does not undo a spy, and a storage.remove left
        // rejecting would quietly change what every later test in this file is
        // about — a logout inside one of them would fail before it wiped auth.
        onTestFinished(() => remove.mockRestore());

        await clearBadge();

        expect(await badgeText()).toBe('');
        expect(await badgeTitle()).toBe('ShikiFAV');
    });
});

describe('restoreBadge', () => {
    // Whether the badge text survives the death of the worker is not measured
    // yet (Ф11-3), so it is restored unconditionally on every start.
    it('redraws the stored count without asking anyone', async () => {
        await showAiredBacklog(backlog);
        await fakeBrowser.action.setBadgeText({ text: '' });

        await restoreBadge();

        expect(await badgeText()).toBe('2');
        expect(await badgeTitle()).toBe('ShikiFAV: 2 тайтла с неотмеченными сериями');
    });

    it('draws an empty badge on a fresh profile', async () => {
        await restoreBadge();

        expect(await badgeText()).toBe('');
        expect(await badgeTitle()).toBe('ShikiFAV');
    });

    // A profile written by another build is untrusted input; the sanitizer keeps
    // it from reaching the arithmetic (badge-backlog.ts).
    it('survives a corrupted stored value', async () => {
        await fakeBrowser.storage.local.set({ badgeBacklog: { '1': 'five' } });

        await restoreBadge();

        expect(await badgeText()).toBe('');
    });
});

describe('applyRateWrite', () => {
    // The criterion of US-12: the counter fades as episodes are marked. Without
    // this hook it would only catch up at the next tick, i.e. half an hour later.
    it('takes a title off the count when the write caught progress up', async () => {
        await showAiredBacklog(backlog);

        await applyRateWrite(rate({ id: '1', episodes: 8 }));

        expect(await badgeText()).toBe('1');
        await expect(getBadgeBacklog()).resolves.toEqual([
            row('1', 8, 8),
            row('2', 12, 12),
            row('3', 4, 3),
        ]);
    });

    it('keeps counting a title that is still behind after a «+1»', async () => {
        await showAiredBacklog(backlog);

        await applyRateWrite(rate({ id: '1', episodes: 4 }));

        expect(await badgeText()).toBe('2');
    });

    // A status the poll does not read means the title is not "waiting" any more,
    // whatever its progress is — the same rule the next tick would apply.
    it('drops a title moved to a status outside the poll', async () => {
        await showAiredBacklog(backlog);

        await applyRateWrite(rate({ id: '1', status: 'dropped', episodes: 3 }));

        expect(await badgeText()).toBe('1');
        await expect(getBadgeBacklog()).resolves.toEqual([row('2', 12, 12), row('3', 4, 3)]);
    });

    it('keeps a title moved between the three polled statuses', async () => {
        await showAiredBacklog(backlog);

        await applyRateWrite(rate({ id: '3', status: 'planned', episodes: 3 }));

        expect(await badgeText()).toBe('2');
    });

    // A write about anything the badge does not count (a manga rate, a title
    // outside the poll) must not cost a redraw at all.
    it('does not touch the badge for an unknown rate', async () => {
        await showAiredBacklog(backlog);
        setBadgeText.mockClear();

        await applyRateWrite(rate({ id: '404', episodes: 1 }));

        expect(setBadgeText).not.toHaveBeenCalled();
        await expect(getBadgeBacklog()).resolves.toEqual(backlog);
    });
});

describe('forgetRate', () => {
    it('stops counting a title deleted from the lists', async () => {
        await showAiredBacklog(backlog);

        await forgetRate('1');

        expect(await badgeText()).toBe('1');
        await expect(getBadgeBacklog()).resolves.toEqual([row('2', 12, 12), row('3', 4, 3)]);
    });

    it('does nothing for a rate the badge never counted', async () => {
        await showAiredBacklog(backlog);
        setBadgeText.mockClear();

        await forgetRate('404');

        expect(setBadgeText).not.toHaveBeenCalled();
    });
});

// Ревью Ф11-9: every hook above is called from exactly one place — the message
// handlers of entrypoints/background.ts — and deleting any of those calls left
// the whole suite green. These tests go through the protocol itself, so the
// criterion of US-12 («счётчик гаснет по мере отметок прогресса») is pinned to
// the wiring and not only to the module.
describe('background write hooks', () => {
    const fetchMock = vi.fn<typeof fetch>();
    const testUser: User = { id: 7, nickname: 'tester', avatarUrl: '' };

    function storedAuth(): NonNullable<LocalState['auth']> {
        return {
            accessToken: 'stored-access',
            refreshToken: 'stored-refresh',
            expiresAt: Date.now() + 60 * 60 * 1000,
            user: testUser,
        };
    }

    // The server answer to a write: everything the badge needs to recount one
    // row without asking Shikimori again.
    function restRate(overrides: Partial<RateState> = {}): Response {
        const state = rate(overrides);
        return new Response(JSON.stringify({ ...state, id: Number(state.id) }), { status: 200 });
    }

    async function startBackground(): Promise<void> {
        await showAiredBacklog(backlog);
        await setLocal('auth', storedAuth());
        // fake-browser has no contextMenus implementation, and background.main()
        // subscribes to onClicked synchronously (Ф5-7).
        vi.spyOn(fakeBrowser.contextMenus.onClicked, 'addListener').mockImplementation(() => {});
        background.main();
        // restoreBadge() runs unawaited on every worker start; letting it settle
        // here keeps its redraw from landing on top of the assertions below.
        await vi.waitFor(async () => expect(await badgeText()).toBe('2'));
    }

    beforeEach(() => {
        fetchMock.mockReset();
        vi.stubGlobal('fetch', fetchMock);
        // Mirrors the registration in entrypoints/background.ts.
        setTokenProvider(ensureToken);
        rateLimiter.reset();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('recounts the badge after rates.update', async () => {
        await startBackground();
        fetchMock.mockResolvedValueOnce(restRate({ id: '1', episodes: 8 }));

        await sendMessage('rates.update', { rateId: '1', patch: { episodes: 8 } });

        expect(await badgeText()).toBe('1');
    });

    it('recounts the badge after rates.increment', async () => {
        await startBackground();
        fetchMock.mockResolvedValueOnce(restRate({ id: '3', episodes: 4 }));

        await sendMessage('rates.increment', { rateId: '3' });

        expect(await badgeText()).toBe('1');
    });

    it('drops the row after rates.delete', async () => {
        await startBackground();
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

        await sendMessage('rates.delete', { rateId: '1' });

        expect(await badgeText()).toBe('1');
        await expect(getBadgeBacklog()).resolves.toEqual([row('2', 12, 12), row('3', 4, 3)]);
    });

    // Ф11 audit. The write path from the popup gets the same fence as the
    // background tick: a REST call can live for minutes (a 429 is retried inside
    // http.ts), and a logout landing in that window makes the answer belong to a
    // session that is over. Re-entering the same account brings the same rate
    // ids back, so a stale answer would silently mark a title as caught up in
    // the new session.
    it('ignores a rates.update answer that outlived its session', async () => {
        await startBackground();
        fetchMock.mockImplementationOnce(async () => {
            // «Выйти» while the request is in the air: clearAuth() moves the
            // epoch and wipes the rows.
            await logout();
            // …and the next session's tick has already drawn its own rows.
            await showAiredBacklog(backlog);
            return restRate({ id: '1', episodes: 8 });
        });

        await sendMessage('rates.update', { rateId: '1', patch: { episodes: 8 } });

        expect(await badgeText()).toBe('2');
        await expect(getBadgeBacklog()).resolves.toEqual(backlog);
    });

    it('ignores a rates.delete answer that outlived its session', async () => {
        await startBackground();
        fetchMock.mockImplementationOnce(async () => {
            await logout();
            await showAiredBacklog(backlog);
            return new Response(null, { status: 204 });
        });

        await sendMessage('rates.delete', { rateId: '1' });

        expect(await badgeText()).toBe('2');
        await expect(getBadgeBacklog()).resolves.toEqual(backlog);
    });

    it('ignores a rates.increment answer that outlived its session', async () => {
        await startBackground();
        fetchMock.mockImplementationOnce(async () => {
            await logout();
            await showAiredBacklog(backlog);
            return restRate({ id: '1', episodes: 8 });
        });

        await sendMessage('rates.increment', { rateId: '1' });

        expect(await badgeText()).toBe('2');
        await expect(getBadgeBacklog()).resolves.toEqual(backlog);
    });

    // A failed write changes nothing on the server, so it must change nothing on
    // the icon either.
    it('leaves the badge alone when the write fails', async () => {
        await startBackground();
        fetchMock.mockResolvedValueOnce(
            new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 }),
        );

        await sendMessage('rates.increment', { rateId: '1' });

        expect(await badgeText()).toBe('2');
        await expect(getBadgeBacklog()).resolves.toEqual(backlog);
    });
});

describe('failures', () => {
    // The badge is decoration on top of an action that already succeeded: a
    // rejected storage write or a missing action API must not fail the write the
    // user made, nor take the background tick down with it.
    it('never rejects when the platform call fails', async () => {
        setBadgeText.mockRejectedValueOnce(new Error('no action api'));

        await expect(showAiredBacklog(backlog)).resolves.toBeUndefined();
        expect(debug).toHaveBeenCalled();
    });

    it('never rejects when reading the stored rows fails', async () => {
        await setLocal('badgeBacklog', backlog);
        vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValueOnce(new Error('storage gone'));

        await expect(restoreBadge()).resolves.toBeUndefined();
        expect(debug).toHaveBeenCalled();
    });

    // Rule 6 of CLAUDE.md: a storage rejection quotes what it was given, and
    // that is list data. Only the kind of the failure may be logged.
    it('logs the kind of the failure and never the failure itself', async () => {
        setBadgeText.mockRejectedValueOnce(new Error('secret: token=abc'));

        await showAiredBacklog(backlog);

        expect(debug).toHaveBeenCalledWith('[badge] update failed:', 'Error');
    });
});
