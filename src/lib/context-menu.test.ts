import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import type { Browser } from 'wxt/browser';
import { SEARCH_MENU_ID, handleMenuClick, registerContextMenu } from './context-menu';
import { i18n } from './i18n';
import { MAX_QUERY_LENGTH, parseSearchQuery } from './search-url';
import { getSession, setSession } from './storage';

// US-8 wiring: registration must be idempotent (menu items outlive the service
// worker) and a click must hand the selection over to the popup (Ф5-11). A
// failure on either side is swallowed — a broken menu must not take the worker
// down with it.

// fakeBrowser ships contextMenus and action.openPopup stubs that throw "not
// implemented", so they are mocked; tabs.create and storage.session are
// implemented and only spied on (mockReset returns them to the real fake
// implementation). console.debug stays muted for the whole file: half of these
// cases exercise the failure paths on purpose.
const removeAll = vi.spyOn(fakeBrowser.contextMenus, 'removeAll');
const create = vi.spyOn(fakeBrowser.contextMenus, 'create');
const openPopup = vi.spyOn(fakeBrowser.action, 'openPopup');
const createTab = vi.spyOn(fakeBrowser.tabs, 'create');
const sessionSet = vi.spyOn(fakeBrowser.storage.session, 'set');
const sessionRemove = vi.spyOn(fakeBrowser.storage.session, 'remove');
const debug = vi.spyOn(console, 'debug');

function clickInfo(
    overrides: Partial<Browser.contextMenus.OnClickData> = {},
): Browser.contextMenus.OnClickData {
    return { menuItemId: SEARCH_MENU_ID, editable: false, ...overrides };
}

beforeEach(() => {
    fakeBrowser.reset();
    removeAll.mockReset();
    create.mockReset();
    openPopup.mockReset();
    createTab.mockReset();
    sessionSet.mockReset();
    sessionRemove.mockReset();
    debug.mockReset();
    removeAll.mockImplementation(() => Promise.resolve());
    create.mockReturnValue(SEARCH_MENU_ID);
    openPopup.mockImplementation(() => Promise.resolve());
    debug.mockImplementation(() => {});
});

describe('registerContextMenu', () => {
    it('creates the selection item with the i18n title carrying the %s placeholder', async () => {
        await registerContextMenu();

        expect(create).toHaveBeenCalledTimes(1);
        const props = create.mock.calls[0]![0];
        expect(props.id).toBe(SEARCH_MENU_ID);
        expect(props.contexts).toEqual(['selection']);
        expect(props.title).toBe(i18n.contextMenu.searchSelection);
        // Chrome substitutes %s with the selection: the title must keep the
        // placeholder and must not interpolate anything by hand.
        expect(props.title).toContain('%s');
    });

    it('wipes previous items before creating the new one', async () => {
        await registerContextMenu();

        expect(removeAll).toHaveBeenCalledTimes(1);
        expect(removeAll.mock.invocationCallOrder[0]!).toBeLessThan(
            create.mock.invocationCallOrder[0]!,
        );
    });

    it('is idempotent: a repeated registration removes and re-creates the same id', async () => {
        await registerContextMenu();
        await expect(registerContextMenu()).resolves.toBeUndefined();

        expect(removeAll).toHaveBeenCalledTimes(2);
        expect(create.mock.calls.map(([props]) => props.id)).toEqual([
            SEARCH_MENU_ID,
            SEARCH_MENU_ID,
        ]);
    });

    it('swallows a rejected removeAll and skips the create', async () => {
        removeAll.mockImplementation(() => Promise.reject(new Error('no permission')));

        await expect(registerContextMenu()).resolves.toBeUndefined();

        expect(create).not.toHaveBeenCalled();
        expect(debug).toHaveBeenCalledWith(
            '[context-menu] failed to register the search item:',
            expect.any(Error),
        );
    });

    it('swallows a throwing create', async () => {
        create.mockImplementation(() => {
            throw new Error('duplicate id');
        });

        await expect(registerContextMenu()).resolves.toBeUndefined();

        expect(debug).toHaveBeenCalledWith(
            '[context-menu] failed to register the search item:',
            expect.any(Error),
        );
    });
});

describe('handleMenuClick', () => {
    it('hands the selection over through pendingSearch and opens the popup', async () => {
        await handleMenuClick(clickInfo({ selectionText: 'Стальной алхимик & Co' }));

        expect(openPopup).toHaveBeenCalledTimes(1);
        await expect(getSession('pendingSearch')).resolves.toEqual({
            query: 'Стальной алхимик & Co',
        });
        // The page in a tab is the fallback only.
        expect(createTab).not.toHaveBeenCalled();
    });

    it('commits pendingSearch before the popup opens', async () => {
        // The popup reads the key while mounting: a write still in flight when
        // the window appears would leave it searching for nothing.
        let seenOnOpen: { query: string } | undefined;
        openPopup.mockImplementation(async () => {
            seenOnOpen = await getSession('pendingSearch');
        });

        await handleMenuClick(clickInfo({ selectionText: 'Berserk' }));

        expect(seenOnOpen).toEqual({ query: 'Berserk' });
    });

    it('sanitizes a multi-line selection into a single-line query', async () => {
        await handleMenuClick(clickInfo({ selectionText: '  Fullmetal\nAlchemist  ' }));

        await expect(getSession('pendingSearch')).resolves.toEqual({
            query: 'Fullmetal Alchemist',
        });
    });

    it('cuts a paragraph-long selection down before handing it to the popup', async () => {
        // The smoke case "выделение в 300+ символов": the popup path must clamp
        // the query just like the URL one does.
        await handleMenuClick(clickInfo({ selectionText: 'б'.repeat(300) }));

        const pending = await getSession('pendingSearch');
        expect(pending?.query).toHaveLength(MAX_QUERY_LENGTH);
        expect(createTab).not.toHaveBeenCalled();
    });

    it('ignores a click on a menu item of someone else', async () => {
        await handleMenuClick(
            clickInfo({ menuItemId: 'other-extension-item', selectionText: 'x' }),
        );
        await handleMenuClick(clickInfo({ menuItemId: 42, selectionText: 'x' }));

        expect(openPopup).not.toHaveBeenCalled();
        expect(createTab).not.toHaveBeenCalled();
        expect(sessionSet).not.toHaveBeenCalled();
        expect(sessionRemove).not.toHaveBeenCalled();
        await expect(getSession('pendingSearch')).resolves.toBeUndefined();
    });

    it('leaves a pending handover alone when another item is clicked', async () => {
        // Another extension's item in the same menu must not swallow the query
        // our own click has just prepared.
        await setSession('pendingSearch', { query: 'берсерк' });

        await handleMenuClick(clickInfo({ menuItemId: 'other-extension-item' }));

        await expect(getSession('pendingSearch')).resolves.toEqual({ query: 'берсерк' });
    });

    it('opens the popup without a pending query when the selection is blank', async () => {
        // A key left by an earlier click must not fire in a popup opened for a
        // selection that carries nothing.
        await setSession('pendingSearch', { query: 'предыдущее выделение' });

        await handleMenuClick(clickInfo({ selectionText: '   ' }));
        await handleMenuClick(clickInfo());

        expect(openPopup).toHaveBeenCalledTimes(2);
        await expect(getSession('pendingSearch')).resolves.toBeUndefined();
        // Still the popup, not the page: a blank selection is not a failure.
        expect(createTab).not.toHaveBeenCalled();
    });

    it('drops the stale key before the popup opens for a blank selection', async () => {
        // Same commit-order requirement as the write: a popup that mounts while
        // the removal is still in flight would replay the previous click.
        await setSession('pendingSearch', { query: 'предыдущее выделение' });
        let seenOnOpen: { query: string } | undefined = { query: 'not read yet' };
        openPopup.mockImplementation(async () => {
            seenOnOpen = await getSession('pendingSearch');
        });

        await handleMenuClick(clickInfo({ selectionText: '\n\t ' }));

        expect(seenOnOpen).toBeUndefined();
    });

    it('falls back to the search page tab when the popup refuses to open', async () => {
        openPopup.mockImplementation(() => Promise.reject(new Error('no active window')));

        await expect(
            handleMenuClick(clickInfo({ selectionText: 'Стальной алхимик & Co' })),
        ).resolves.toBeUndefined();

        expect(createTab).toHaveBeenCalledTimes(1);
        const url = new URL(createTab.mock.calls[0]![0].url ?? '');
        expect(url.pathname).toBe('/search.html');
        expect(parseSearchQuery(url.search)).toBe('Стальной алхимик & Co');
        // The popup never opened, so the key would otherwise surface on the next
        // manual open, long after this click.
        await expect(getSession('pendingSearch')).resolves.toBeUndefined();
    });

    it('falls back on a build without action.openPopup', async () => {
        // Chrome < 127 (and the fakeBrowser default) has no working openPopup:
        // the synchronous throw must land in the same fallback.
        openPopup.mockImplementation(() => {
            throw new TypeError('browser.action.openPopup is not a function');
        });

        await expect(
            handleMenuClick(clickInfo({ selectionText: 'Berserk' })),
        ).resolves.toBeUndefined();

        expect(createTab).toHaveBeenCalledTimes(1);
        expect(debug).toHaveBeenCalledWith('[context-menu] failed to open the popup:', 'TypeError');
    });

    it('falls back to the tab when the handover write itself fails', async () => {
        // A query that never reached storage cannot reach the popup either, so
        // this failure takes the same exit as a refused popup.
        sessionSet.mockImplementation(() => Promise.reject(new Error('storage full')));

        await handleMenuClick(clickInfo({ selectionText: 'берсерк' }));

        expect(openPopup).not.toHaveBeenCalled();
        expect(createTab).toHaveBeenCalledTimes(1);
        const url = new URL(createTab.mock.calls[0]![0].url ?? '');
        expect(parseSearchQuery(url.search)).toBe('берсерк');
    });

    it('still opens the tab when dropping the pending key fails', async () => {
        openPopup.mockImplementation(() => Promise.reject(new Error('no active window')));
        sessionRemove.mockImplementation(() => Promise.reject(new Error('storage locked')));

        await expect(
            handleMenuClick(clickInfo({ selectionText: 'берсерк' })),
        ).resolves.toBeUndefined();

        // The stale key costs one replayed search at worst; losing the fallback
        // tab would cost the click itself.
        expect(createTab).toHaveBeenCalledTimes(1);
    });

    it('swallows a failing tabs.create and keeps the selection out of the log', async () => {
        // Chrome quotes the rejected URL in the message ("Invalid url: …"), and
        // that URL carries the selection — only the error kind may be logged.
        openPopup.mockImplementation(() =>
            Promise.reject(new Error('No active browser window: секретное выделение')),
        );
        createTab.mockImplementation(() =>
            Promise.reject(
                new Error('Invalid url: "chrome-extension://x/search.html?q=секретное+выделение"'),
            ),
        );

        await expect(
            handleMenuClick(clickInfo({ selectionText: 'секретное выделение' })),
        ).resolves.toBeUndefined();

        expect(debug).toHaveBeenCalledWith(
            '[context-menu] failed to open the search tab:',
            'Error',
        );
        const logged = debug.mock.calls.flat().map(String).join(' ');
        expect(logged).not.toContain('секретное выделение');
    });
});
