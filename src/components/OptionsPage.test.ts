import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { fakeBrowser } from 'wxt/testing';
import type { ApiError, AuthState } from '@/src/lib/api/types';
import type { MessageHandlers } from '@/src/lib/messaging';
import type { LocalState, SessionState } from '@/src/lib/storage';
import { DEFAULT_ORIGIN } from '@/src/lib/config';
import { i18n, statusLabel } from '@/src/lib/i18n';
import {
    clickOn,
    createApp,
    createFakeElement,
    find,
    findAll,
    fire,
    textOf,
} from './fake-renderer';
import type { FakeElement } from './fake-renderer';

// Ф6-3 options page: seven settings behind vertical tabs, opened in its own
// tab; Ф8-3 added a fourth tab, «Поддержать», and the one-shot handover that
// opens the page on it. Mounted through the shared fake renderer; every test
// rebuilds the module graph because use-settings / use-auth keep module state.

const VERSION = '1.2.3';
const ICON_URL = 'chrome-extension://test/icon/48.png';

const authorized: AuthState = {
    status: 'authorized',
    user: { id: 1, nickname: 'tester', avatarUrl: 'https://cdn.test/x160.png' },
};

interface Mounted {
    container: FakeElement;
    // Live storage of the SAME module graph the page is mounted from.
    getSettings: () => Promise<LocalState['settings']>;
    getSession: <K extends keyof SessionState>(key: K) => Promise<SessionState[K] | undefined>;
    setSession: <K extends keyof SessionState>(key: K, value: SessionState[K]) => Promise<void>;
    originCalls: string[];
}

let cleanups: Array<() => void> = [];

async function mountPage(
    options: {
        auth?: AuthState;
        seed?: Partial<LocalState['settings']>;
        // Section handed over by the popup header (Ф8-3). A raw string, so a
        // value from another build is expressible.
        pendingSection?: string;
        // Replaces a handler with a failing (or otherwise special) one; the
        // defaults below are the happy path.
        overrides?: Partial<MessageHandlers>;
    } = {},
): Promise<Mounted> {
    vi.resetModules();
    const storage = await import('@/src/lib/storage');
    if (options.seed) {
        await storage.setSettings(options.seed);
    }
    if (options.pendingSection !== undefined) {
        // Written before the mount, exactly as the header writes it before
        // openOptionsPage() opens this page.
        await fakeBrowser.storage.session.set({ pendingOptionsSection: options.pendingSection });
    }

    // Auth flips to anonymous the moment the domain changes, exactly as
    // background does it: logout() first, the new origin after.
    let auth = options.auth ?? authorized;
    const originCalls: string[] = [];
    const messaging = await import('@/src/lib/messaging');
    const handlers: MessageHandlers = {
        ping: async () => ({ pong: true }),
        'auth.getState': async () => auth,
        'auth.login': async () => ({ user: { id: 1, nickname: 'tester', avatarUrl: '' } }),
        'auth.logout': async () => {
            auth = { status: 'anonymous' };
            return {};
        },
        'search.titles': async () => ({ items: [] }),
        'rates.list': async () => ({ items: [], hasMore: false }),
        'calendar.list': async () => ({ items: [] }),
        'posters.fetch': async () => ({ posters: {} }),
        'rates.create': async () => ({ rate: { id: '100', status: 'planned' } }),
        'rates.update': async () => ({
            rate: { id: '100', status: 'watching', score: 0, episodes: 0, chapters: 0, volumes: 0 },
        }),
        'rates.delete': async () => ({}),
        'rates.increment': async () => ({
            rate: { id: '100', status: 'watching', score: 0, episodes: 0, chapters: 0, volumes: 0 },
        }),
        'settings.setOrigin': async ({ origin }) => {
            originCalls.push(origin);
            auth = { status: 'anonymous' };
            await storage.setSettings({ origin });
            return {};
        },
        ...options.overrides,
    };
    messaging.onMessage(handlers);

    const { default: OptionsPage } = await import('@/entrypoints/options/OptionsPage.vue');
    const container = createFakeElement('#container');
    const app = createApp(OptionsPage, { version: VERSION, iconUrl: ICON_URL });
    app.mount(container);
    cleanups.push(() => app.unmount());

    return {
        container,
        getSettings: storage.getSettings,
        getSession: storage.getSession,
        setSession: storage.setSession,
        originCalls,
    };
}

// --- queries ----------------------------------------------------------------

function tabs(container: FakeElement): FakeElement[] {
    return findAll(container, 'options__tab');
}

function activeTabLabel(container: FakeElement): string {
    return textOf(find(container, 'options__tab--active')).trim();
}

function panelLabels(container: FakeElement): string[] {
    return findAll(container, 'opt__label').map((el) => textOf(el).trim());
}

// ChipGroup rows are told apart by their aria-label — the same label the
// section shows above them.
function chipRow(container: FakeElement, ariaLabel: string): FakeElement {
    const row = findAll(container, 'chips').find((el) => el.props['aria-label'] === ariaLabel);
    if (!row) {
        throw new Error(`no chip row labelled "${ariaLabel}"`);
    }
    return row;
}

function chip(container: FakeElement, ariaLabel: string, label: string): FakeElement {
    const found = findAll(chipRow(container, ariaLabel), 'chip').find(
        (el) => textOf(el).trim() === label,
    );
    if (!found) {
        throw new Error(`no chip "${label}" in the row labelled "${ariaLabel}"`);
    }
    return found;
}

function activeChip(container: FakeElement, ariaLabel: string): string {
    return textOf(find(chipRow(container, ariaLabel), 'chip--active')).trim();
}

function keydownOn(el: FakeElement, key: string): { preventDefault: ReturnType<typeof vi.fn> } {
    const event = { key, preventDefault: vi.fn() };
    fire(el, 'keydown', event);
    return event;
}

async function openSection(container: FakeElement, index: number): Promise<void> {
    clickOn(tabs(container)[index]);
    await nextTick();
}

// Opens the domain select and picks the option whose label contains `host`.
async function pickOrigin(container: FakeElement, host: string): Promise<void> {
    clickOn(find(container, 'xselect'));
    await nextTick();
    const option = findAll(container, 'xselect__opt').find((el) => textOf(el).includes(host));
    if (!option) {
        throw new Error(`no domain option for "${host}"`);
    }
    clickOn(option);
}

// --- tests ------------------------------------------------------------------

beforeEach(() => {
    fakeBrowser.reset();
    // No DOM here; only the listener surface XSelect touches while open.
    vi.stubGlobal('document', {
        addEventListener: () => {},
        removeEventListener: () => {},
    });
});

afterEach(() => {
    for (const cleanup of cleanups) {
        cleanup();
    }
    cleanups = [];
    vi.unstubAllGlobals();
});

describe('OptionsPage (Ф6-3)', () => {
    it('opens on «Вид» with a labelled vertical tablist and a roving tabindex', async () => {
        const { container } = await mountPage();

        const list = find(container, 'options__tabs');
        expect(list.props.role).toBe('tablist');
        expect(list.props['aria-orientation']).toBe('vertical');
        expect(list.props['aria-label']).toBe(i18n.options.sectionsLabel);

        const all = tabs(container);
        expect(all).toHaveLength(4);
        expect(all.map((el) => el.props.role)).toEqual(['tab', 'tab', 'tab', 'tab']);
        expect(all.map((el) => el.props['aria-selected'])).toEqual([true, false, false, false]);
        // Only the selected tab is tabbable: the list is one Tab stop.
        expect(all.map((el) => el.props.tabindex)).toEqual([0, -1, -1, -1]);
        expect(activeTabLabel(container)).toBe(i18n.options.sectionView);

        const panel = find(container, 'options__panel');
        expect(panel.props.role).toBe('tabpanel');
        expect(panel.props['aria-labelledby']).toBe(all[0].props.id);
        // Only the active panel is rendered, so only the selected tab points at it.
        expect(all.map((el) => el.props['aria-controls'])).toEqual([
            panel.props.id,
            undefined,
            undefined,
            undefined,
        ]);
        expect(panelLabels(container)).toEqual([
            i18n.options.themeLabel,
            i18n.options.titleLangLabel,
        ]);
    });

    it('shows the long section label and its narrow-window variant', async () => {
        const { container } = await mountPage();
        expect(textOf(find(container, 'options__tab-label--wide')).trim()).toBe(
            i18n.options.sectionAccount,
        );
        expect(textOf(find(container, 'options__tab-label--narrow')).trim()).toBe(
            i18n.options.sectionAccountShort,
        );
    });

    it('switches the panel on a click and moves aria-selected with it', async () => {
        const { container } = await mountPage();

        await openSection(container, 1);
        expect(tabs(container).map((el) => el.props['aria-selected'])).toEqual([
            false,
            true,
            false,
            false,
        ]);
        expect(panelLabels(container)).toEqual([
            i18n.options.startTabLabel,
            i18n.options.quickStatusLabel,
            i18n.options.defaultsLabel,
        ]);
        expect(find(container, 'options__panel').props['aria-labelledby']).toBe(
            tabs(container)[1].props.id,
        );

        await openSection(container, 2);
        expect(panelLabels(container)).toEqual([i18n.options.originLabel, i18n.options.dataLabel]);
    });

    it.each([
        ['ArrowDown', 1, i18n.options.sectionBehavior],
        // Wrapping upwards from the first tab lands on the last one — «Поддержать»
        // since Ф8-3.
        ['ArrowUp', 3, i18n.options.sectionSupport],
        ['End', 3, i18n.options.sectionSupport],
    ])('moves the selection and the focus with %s', async (key, index, label) => {
        const { container } = await mountPage();

        const event = keydownOn(tabs(container)[0], key);
        await nextTick();

        expect(event.preventDefault).toHaveBeenCalledOnce();
        expect(activeTabLabel(container)).toContain(label);
        expect(tabs(container)[index].focused).toBe(true);
        expect(tabs(container).map((el) => el.props.tabindex)).toEqual(
            [0, 1, 2, 3].map((i) => (i === index ? 0 : -1)),
        );
    });

    it('returns to the first section with Home', async () => {
        const { container } = await mountPage();
        await openSection(container, 2);

        keydownOn(tabs(container)[2], 'Home');
        await nextTick();

        expect(activeTabLabel(container)).toBe(i18n.options.sectionView);
        expect(tabs(container)[0].focused).toBe(true);
    });

    it('ignores keys it does not own', async () => {
        const { container } = await mountPage();
        const event = keydownOn(tabs(container)[0], 'a');
        await nextTick();
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(activeTabLabel(container)).toBe(i18n.options.sectionView);
    });

    it('renders the version from the prop', async () => {
        const { container } = await mountPage();
        expect(textOf(find(container, 'options__version')).trim()).toBe(
            `${i18n.options.version} ${VERSION}`,
        );
    });

    // The header shows the shipped extension icon, so a manifest icon change
    // cannot leave a stale stand-in glyph behind (Ф6-26).
    it('renders the extension icon in the header from the prop', async () => {
        const { container } = await mountPage();
        expect(find(container, 'options__logo').props.src).toBe(ICON_URL);
    });

    // --- writes ---------------------------------------------------------------

    it('writes the theme and the title language, and follows storage back', async () => {
        const { container, getSettings } = await mountPage();

        clickOn(chip(container, i18n.options.themeLabel, i18n.options.themeDark));
        await vi.waitFor(async () => expect((await getSettings()).theme).toBe('dark'));
        // No local mirror: the active chip comes back through the storage
        // subscription of use-settings.
        await vi.waitFor(() =>
            expect(activeChip(container, i18n.options.themeLabel)).toBe(i18n.options.themeDark),
        );

        clickOn(chip(container, i18n.options.titleLangLabel, i18n.options.titleLangRomaji));
        await vi.waitFor(async () => expect((await getSettings()).titleLang).toBe('romaji'));
        // The unrelated key is untouched: setSettings patches, never replaces.
        expect((await getSettings()).theme).toBe('dark');
    });

    it('writes the start tab', async () => {
        const { container, getSettings } = await mountPage();
        await openSection(container, 1);

        clickOn(chip(container, i18n.options.startTabLabel, i18n.tabs.search));
        await vi.waitFor(async () => expect((await getSettings()).startTab).toBe('search'));
    });

    // Ф7-9: the third tab is pinnable like the other two.
    it('offers every popup tab plus «Последняя открытая», and writes the calendar', async () => {
        const { container, getSettings } = await mountPage();
        await openSection(container, 1);

        expect(
            findAll(chipRow(container, i18n.options.startTabLabel), 'chip').map((el) =>
                textOf(el).trim(),
            ),
        ).toEqual([
            i18n.tabs.search,
            i18n.tabs.myLists,
            i18n.tabs.calendar,
            i18n.options.startTabLast,
        ]);

        clickOn(chip(container, i18n.options.startTabLabel, i18n.tabs.calendar));
        await vi.waitFor(async () => expect((await getSettings()).startTab).toBe('calendar'));
    });

    it('writes the one-click status', async () => {
        const { container, getSettings } = await mountPage();
        await openSection(container, 1);

        clickOn(chip(container, i18n.options.quickStatusLabel, statusLabel('completed')));
        await vi.waitFor(async () => expect((await getSettings()).quickStatus).toBe('completed'));
    });

    it('writes both default filters', async () => {
        const { container, getSettings } = await mountPage();
        await openSection(container, 1);

        clickOn(chip(container, i18n.options.defaultTypeLabel, i18n.lists.types.ranobe));
        await vi.waitFor(async () =>
            expect((await getSettings()).defaultSearchType).toBe('ranobe'),
        );

        clickOn(chip(container, i18n.options.defaultListStatusLabel, statusLabel('planned')));
        await vi.waitFor(async () =>
            expect((await getSettings()).defaultListStatus).toBe('planned'),
        );
    });

    it('starts every control from the stored value', async () => {
        const { container } = await mountPage({
            seed: {
                theme: 'light',
                titleLang: 'romaji',
                startTab: 'lists',
                quickStatus: 'dropped',
                defaultSearchType: 'manga',
                defaultListStatus: 'on_hold',
            },
        });

        await vi.waitFor(() =>
            expect(activeChip(container, i18n.options.themeLabel)).toBe(i18n.options.themeLight),
        );
        expect(activeChip(container, i18n.options.titleLangLabel)).toBe(
            i18n.options.titleLangRomaji,
        );

        await openSection(container, 1);
        expect(activeChip(container, i18n.options.startTabLabel)).toBe(i18n.tabs.myLists);
        expect(activeChip(container, i18n.options.quickStatusLabel)).toBe(statusLabel('dropped'));
        expect(activeChip(container, i18n.options.defaultTypeLabel)).toBe(i18n.lists.types.manga);
        expect(activeChip(container, i18n.options.defaultListStatusLabel)).toBe(
            statusLabel('on_hold'),
        );
    });

    // --- account and data -----------------------------------------------------

    it('changes the domain through background and then shows the anonymous state', async () => {
        const { container, getSettings, originCalls } = await mountPage();
        await openSection(container, 2);
        // Signed in: the session can be ended from here.
        await vi.waitFor(() => expect(findAll(container, 'opt__btn--danger')).toHaveLength(1));
        expect(textOf(find(container, 'xselect__val')).trim()).toBe('shikimori.io');

        await pickOrigin(container, 'shikimori.one');

        // Never written from the page itself: background ends the session first.
        await vi.waitFor(() => expect(originCalls).toEqual(['https://shikimori.one']));
        await vi.waitFor(async () =>
            expect((await getSettings()).origin).toBe('https://shikimori.one'),
        );
        await vi.waitFor(() =>
            expect(textOf(find(container, 'xselect__val')).trim()).toBe('shikimori.one'),
        );
        // The session is over — the page says so instead of still offering «Выйти».
        await vi.waitFor(() => expect(findAll(container, 'opt__btn--danger')).toHaveLength(0));
    });

    // Ф6-23: the select has no local mirror, so a refused switch snaps it back to
    // the stored domain — silently, unless the failure is spelled out.
    it('keeps the domain and shows the error when background refuses the switch', async () => {
        const calls: string[] = [];
        const { container, getSettings } = await mountPage({
            overrides: {
                'settings.setOrigin': async ({ origin }) => {
                    calls.push(origin);
                    throw { kind: 'network' } satisfies ApiError;
                },
            },
        });
        await openSection(container, 2);
        await vi.waitFor(() => expect(findAll(container, 'opt__btn--danger')).toHaveLength(1));

        await pickOrigin(container, 'shikimori.one');

        await vi.waitFor(() => expect(calls).toEqual(['https://shikimori.one']));
        await vi.waitFor(() =>
            expect(textOf(find(container, 'toast')).trim()).toBe(i18n.errors.network),
        );
        // Nothing moved: neither the stored domain nor the session.
        expect((await getSettings()).origin).toBe(DEFAULT_ORIGIN);
        expect(textOf(find(container, 'xselect__val')).trim()).toBe(new URL(DEFAULT_ORIGIN).host);
        expect(findAll(container, 'opt__btn--danger')).toHaveLength(1);
    });

    it('clears the session cache and confirms it with a toast', async () => {
        const { container, getSession } = await mountPage();
        fakeBrowser.storage.session.set({ lastTab: 'lists' });
        await openSection(container, 2);

        const clear = findAll(container, 'opt__btn').find(
            (el) => textOf(el).trim() === i18n.options.clearCache,
        );
        clickOn(clear!);

        await vi.waitFor(async () => expect(await getSession('lastTab')).toBeUndefined());
        await vi.waitFor(() =>
            expect(textOf(find(container, 'toast')).trim()).toBe(i18n.options.cacheCleared),
        );
    });

    it('ends the session from «Выйти»', async () => {
        const { container } = await mountPage();
        await openSection(container, 2);
        await vi.waitFor(() => expect(findAll(container, 'opt__btn--danger')).toHaveLength(1));

        clickOn(find(container, 'opt__btn--danger'));

        await vi.waitFor(() => expect(findAll(container, 'opt__btn--danger')).toHaveLength(0));
    });

    it('hides «Выйти» for an anonymous user but keeps the rest usable', async () => {
        const { container, getSettings } = await mountPage({ auth: { status: 'anonymous' } });
        await openSection(container, 2);

        // Give the auth state every chance to arrive before asserting absence.
        await vi.waitFor(() => expect(findAll(container, 'xselect')).toHaveLength(1));
        for (let i = 0; i < 10; i += 1) {
            await nextTick();
        }
        expect(findAll(container, 'opt__btn--danger')).toHaveLength(0);
        expect(findAll(container, 'opt__btn')).toHaveLength(1);

        // Local settings still work without a session.
        await openSection(container, 0);
        clickOn(chip(container, i18n.options.themeLabel, i18n.options.themeLight));
        await vi.waitFor(async () => expect((await getSettings()).theme).toBe('light'));
    });

    // --- «Поддержать» and the handover from the popup header (Ф8-3) ------------

    describe('the «Поддержать» section', () => {
        it('is the last tab and owns the panel when selected', async () => {
            const { container } = await mountPage();
            expect(tabs(container).map((el) => textOf(el).trim())).toEqual([
                i18n.options.sectionView,
                i18n.options.sectionBehavior,
                // The long label plus its narrow-window variant.
                `${i18n.options.sectionAccount}${i18n.options.sectionAccountShort}`,
                i18n.options.sectionSupport,
            ]);

            await openSection(container, 3);

            expect(activeTabLabel(container)).toBe(i18n.options.sectionSupport);
            expect(find(container, 'options__panel').props['aria-labelledby']).toBe(
                tabs(container)[3].props.id,
            );
        });

        // The key, not a URL hash: openOptionsPage() focuses an already open
        // options tab without reloading it.
        it('opens on the handed-over section and drops the key', async () => {
            const { container, getSession } = await mountPage({ pendingSection: 'support' });

            await vi.waitFor(() =>
                expect(activeTabLabel(container)).toBe(i18n.options.sectionSupport),
            );
            // Consumed exactly once: a key left behind would jump the section
            // again on the next visit.
            await vi.waitFor(async () =>
                expect(await getSession('pendingOptionsSection')).toBeUndefined(),
            );
        });

        // Same rule as the persisted popup tabs (Ф7-9): a value from another
        // build names a section this one does not have.
        it('ignores an unknown section and stays on «Вид»', async () => {
            const { container, getSession } = await mountPage({ pendingSection: 'telemetry' });

            await vi.waitFor(async () =>
                expect(await getSession('pendingOptionsSection')).toBeUndefined(),
            );
            for (let i = 0; i < 10; i += 1) {
                await nextTick();
            }
            expect(activeTabLabel(container)).toBe(i18n.options.sectionView);
            // Never a page with no section selected.
            expect(findAll(container, 'options__tab--active')).toHaveLength(1);
        });

        it('switches an already open page on the fly', async () => {
            const { container, getSession, setSession } = await mountPage();
            // The tab has been sitting on another section since the last visit.
            await openSection(container, 1);

            await setSession('pendingOptionsSection', 'support');

            await vi.waitFor(() =>
                expect(activeTabLabel(container)).toBe(i18n.options.sectionSupport),
            );
            await vi.waitFor(async () =>
                expect(await getSession('pendingOptionsSection')).toBeUndefined(),
            );
        });

        it('leaves the page alone when another session key changes', async () => {
            const { container, setSession } = await mountPage();
            await openSection(container, 1);

            await setSession('lastTab', 'calendar');

            for (let i = 0; i < 10; i += 1) {
                await nextTick();
            }
            expect(activeTabLabel(container)).toBe(i18n.options.sectionBehavior);
        });
    });
});
