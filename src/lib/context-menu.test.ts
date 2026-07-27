import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import type { Browser } from 'wxt/browser';
import { SEARCH_MENU_ID, handleMenuClick, registerContextMenu } from './context-menu';
import { i18n } from './i18n';
import { parseSearchQuery } from './search-url';

// US-8 wiring: registration must be idempotent (menu items outlive the service
// worker) and a click must open search.html?q=… A failure on either side is
// swallowed — a broken menu must not take the worker down with it.

// fakeBrowser ships contextMenus stubs that throw "not implemented", so they are
// mocked; tabs.create is implemented and only spied on (mockReset returns it to
// the real fake implementation). console.debug stays muted for the whole file:
// half of these cases exercise the failure paths on purpose.
const removeAll = vi.spyOn(fakeBrowser.contextMenus, 'removeAll');
const create = vi.spyOn(fakeBrowser.contextMenus, 'create');
const createTab = vi.spyOn(fakeBrowser.tabs, 'create');
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
    createTab.mockReset();
    debug.mockReset();
    removeAll.mockImplementation(() => Promise.resolve());
    create.mockReturnValue(SEARCH_MENU_ID);
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
    it('opens the search page with the selected text as the q parameter', async () => {
        await handleMenuClick(clickInfo({ selectionText: 'Стальной алхимик & Co' }));

        expect(createTab).toHaveBeenCalledTimes(1);
        const url = new URL(createTab.mock.calls[0]![0].url ?? '');
        expect(url.pathname).toBe('/search.html');
        expect(parseSearchQuery(url.search)).toBe('Стальной алхимик & Co');
    });

    it('sanitizes a multi-line selection into a single-line query', async () => {
        await handleMenuClick(clickInfo({ selectionText: '  Fullmetal\nAlchemist  ' }));

        const url = new URL(createTab.mock.calls[0]![0].url ?? '');
        expect(url.searchParams.get('q')).toBe('Fullmetal Alchemist');
    });

    it('ignores a click on a menu item of someone else', async () => {
        await handleMenuClick(
            clickInfo({ menuItemId: 'other-extension-item', selectionText: 'x' }),
        );
        await handleMenuClick(clickInfo({ menuItemId: 42, selectionText: 'x' }));

        expect(createTab).not.toHaveBeenCalled();
    });

    it('opens the page without q when the selection is blank or missing', async () => {
        await handleMenuClick(clickInfo({ selectionText: '   ' }));
        await handleMenuClick(clickInfo());

        expect(createTab).toHaveBeenCalledTimes(2);
        for (const [props] of createTab.mock.calls) {
            const url = new URL(props.url ?? '');
            expect(url.pathname).toBe('/search.html');
            expect(url.searchParams.has('q')).toBe(false);
        }
    });

    it('swallows a failing tabs.create and keeps the selection out of the log', async () => {
        // Chrome quotes the rejected URL in the message ("Invalid url: …"), and
        // that URL carries the selection — only the error kind may be logged.
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
