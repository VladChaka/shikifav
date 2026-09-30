import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { fakeBrowser } from 'wxt/testing';
import type { AnalyticsEvent } from '@/src/lib/analytics-events';
import type { ApiError, AuthState } from '@/src/lib/api/types';
import type { DonationMethod, SupportAction } from '@/src/lib/donations';
import type { MessageHandlers } from '@/src/lib/messaging';
import type { LocalState, SessionState } from '@/src/lib/storage';
import { DEFAULT_ORIGIN } from '@/src/lib/config';
import { i18n, statusLabel } from '@/src/lib/i18n';
import { OPTIONS_SECTIONS } from '@/src/lib/storage';
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

// Everything Vue would otherwise throw out of a render or a watcher. Without a
// handler such an error only shows up as an unhandled rejection AFTER the test
// has passed on a frozen tree — which is exactly how a page that stopped
// rendering could stay green (Ф8-6).
let renderErrors: unknown[] = [];

async function mountPage(
    options: {
        auth?: AuthState;
        seed?: Partial<LocalState['settings']>;
        // Section handed over by the popup header (Ф8-3). A raw string, so a
        // value from another build is expressible.
        pendingSection?: string;
        // Content of the «Поддержать» section (Ф8-2). No longer empty in the
        // shipped build — it carries the Boosty method and the mail line — and
        // mocked for exactly that reason: what these tests pin is how a row is
        // rendered (link or text, the same new-tab attributes on every live
        // link, a method dropped when its address is unusable), not which
        // addresses the owner happens to ship. Stating the list per test keeps a
        // hand-edited config out of the assertions, and lets a test ask for a
        // state the real one does not have — an empty list, a dead address,
        // both kinds of address at once.
        donations?: { methods?: readonly DonationMethod[]; actions?: readonly SupportAction[] };
        // Whether Chrome already holds the optional `notifications` permission
        // (Ф11-11). Left out entirely, the fake API throws «not implemented» —
        // which the page reads as «нет», the same as a real refusal.
        notificationsGranted?: boolean;
        // Replaces a handler with a failing (or otherwise special) one; the
        // defaults below are the happy path.
        overrides?: Partial<MessageHandlers>;
    } = {},
): Promise<Mounted> {
    vi.resetModules();
    if (options.notificationsGranted !== undefined) {
        vi.spyOn(fakeBrowser.permissions, 'contains').mockResolvedValue(
            options.notificationsGranted as never,
        );
    }
    if (options.donations) {
        const { methods = [], actions = [] } = options.donations;
        // doMock, not mock: the page is imported dynamically below, after this
        // call, so hoisting would buy nothing.
        vi.doMock('@/src/lib/donations', async () => ({
            ...(await vi.importActual<typeof import('@/src/lib/donations')>('@/src/lib/donations')),
            DONATION_METHODS: methods,
            SUPPORT_ACTIONS: actions,
        }));
        cleanups.push(() => vi.doUnmock('@/src/lib/donations'));
    }
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
        'analytics.track': async () => ({}),
        'auth.getState': async () => auth,
        'auth.login': async () => ({ user: { id: 1, nickname: 'tester', avatarUrl: '' } }),
        'auth.logout': async () => {
            auth = { status: 'anonymous' };
            return {};
        },
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
    app.config.errorHandler = (e) => {
        renderErrors.push(e);
    };
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

// One row of a «Поддержать» list, with the whitespace of the template squeezed
// out: «Boosty — разовый донат».
function supportRows(container: FakeElement): string[] {
    return findAll(container, 'sup__item').map((el) => textOf(el).replace(/\s+/g, ' ').trim());
}

function panelHints(container: FakeElement): string[] {
    return findAll(container, 'opt__hint').map((el) => textOf(el).trim());
}

// The one line of «Новые серии» that changes with the state of the block; null
// when the block says nothing at all (notifications off, or nothing known yet).
const EPISODES_STATUS_ID = 'options-episodes-status';

function episodesStatus(container: FakeElement): string | null {
    const line = findAll(container, 'opt__hint').find((el) => el.props.id === EPISODES_STATUS_ID);
    return line ? textOf(line).trim() : null;
}

function allowButton(container: FakeElement): FakeElement | undefined {
    return findAll(container, 'opt__btn').find(
        (el) => textOf(el).trim() === i18n.options.notifyAllow,
    );
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
    renderErrors = [];
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
    // The permissions surface is spied per test (fakeBrowser implements none of
    // it), and a spy left behind would decide the state of a later mount.
    vi.restoreAllMocks();
    // Any test, not just the one that looks for it: a throwing render leaves the
    // last good tree in place, so the assertions above it can all still hold.
    expect(renderErrors).toEqual([]);
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

    // Ф8-6: the vocabulary in storage.ts (which validates the handover) and the
    // labelled list inside the component are two hand-kept lists that nothing
    // else connects. The tab ids are built from the section ids, so this pins
    // both the membership and the order.
    it('renders exactly the sections storage knows about, in their order', async () => {
        const { container } = await mountPage();
        expect(tabs(container).map((el) => el.props.id)).toEqual(
            OPTIONS_SECTIONS.map((id) => `options-tab-${id}`),
        );
    });

    // The other half of the same problem: should the lists drift anyway, the
    // page must still draw. A blank settings page is the one page a profile
    // written by another build could have been fixed from (Ф6-23).
    it('keeps drawing when storage names a section it has no tab for', async () => {
        vi.doMock('@/src/lib/storage', async () => {
            const actual =
                await vi.importActual<typeof import('@/src/lib/storage')>('@/src/lib/storage');
            return {
                ...actual,
                // A build that ships one section more than this component does.
                OPTIONS_SECTIONS: [...actual.OPTIONS_SECTIONS, 'telemetry'],
                isOptionsSection: (value: unknown) =>
                    value === 'telemetry' || actual.isOptionsSection(value),
            };
        });
        cleanups.push(() => vi.doUnmock('@/src/lib/storage'));

        const { container, getSession } = await mountPage({ pendingSection: 'telemetry' });

        await vi.waitFor(async () =>
            expect(await getSession('pendingOptionsSection')).toBeUndefined(),
        );
        for (let i = 0; i < 10; i += 1) {
            await nextTick();
        }
        // Falls back to the section the page opens on, with its panel intact —
        // and, above all, without a render that threw (see renderErrors).
        expect(renderErrors).toEqual([]);
        expect(activeTabLabel(container)).toBe(i18n.options.sectionView);
        expect(findAll(container, 'options__tab--active')).toHaveLength(1);
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
            // Ф11-11: «Новые серии» стоит последним — новый блок добавлен
            // снизу, три знакомые настройки не двигаются.
            i18n.options.episodesLabel,
        ]);
        expect(find(container, 'options__panel').props['aria-labelledby']).toBe(
            tabs(container)[1].props.id,
        );

        await openSection(container, 2);
        expect(panelLabels(container)).toEqual([
            i18n.options.originLabel,
            i18n.options.dataLabel,
            // Ф10-2: статистика — это про данные, поэтому она в этом разделе,
            // а не в «Поведении».
            i18n.options.analyticsLabel,
        ]);
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

    // Ф10-14 --------------------------------------------------------------------

    it('reports which setting was changed, with the theme value', async () => {
        const events: AnalyticsEvent[] = [];
        const { container } = await mountPage({
            overrides: {
                'analytics.track': async (event) => {
                    events.push(event);
                    return {};
                },
            },
        });

        clickOn(chip(container, i18n.options.themeLabel, i18n.options.themeDark));

        await vi.waitFor(() =>
            expect(events).toContainEqual({
                name: 'setting_changed',
                params: { setting: 'theme', value: 'dark' },
            }),
        );
    });

    it('says nothing when the user switches statistics off, and drops the id', async () => {
        // The one setting deliberately left out of the reporting: the last act
        // of an opt-out must not be to report the opt-out.
        const events: AnalyticsEvent[] = [];
        const storage = await import('@/src/lib/storage');
        const { container, getSettings } = await mountPage({
            overrides: {
                'analytics.track': async (event) => {
                    events.push(event);
                    return {};
                },
            },
        });
        await storage.setLocal('analyticsClientId', 'to-be-forgotten');
        await openSection(container, 2);

        clickOn(chip(container, i18n.options.analyticsLabel, i18n.options.analyticsOff));

        await vi.waitFor(async () => expect((await getSettings()).analytics).toBe(false));
        await vi.waitFor(async () =>
            expect(await storage.getLocal('analyticsClientId')).toBeUndefined(),
        );
        expect(events).toEqual([]);
    });

    // Ф11 audit. The two writes of an opt-out used to be fired unawaited, so the
    // order they landed in was nobody's decision. Landing the delete first opens a
    // window where the profile has no identifier but the stored setting still
    // reads `true` — and any event arriving in it creates a new identifier and
    // sends under it, which is the deletion PRIVACY.md promises, undone.
    it('stores the switch before deleting the identifier, never the other way round', async () => {
        const storage = await import('@/src/lib/storage');
        // What the gate said at the moment the delete landed. `true` here is the
        // window; an empty array would mean the delete never happened at all.
        const analyticsAtDelete: (boolean | undefined)[] = [];
        const { container, getSettings } = await mountPage();
        await storage.setLocal('analyticsClientId', 'to-be-forgotten');
        const realRemove = fakeBrowser.storage.local.remove.bind(fakeBrowser.storage.local);
        vi.spyOn(fakeBrowser.storage.local, 'remove').mockImplementation((async (
            keys: string | string[],
        ) => {
            if ([keys].flat().includes('analyticsClientId')) {
                analyticsAtDelete.push((await storage.getSettings()).analytics);
            }
            return realRemove(keys);
        }) as never);
        await openSection(container, 2);

        clickOn(chip(container, i18n.options.analyticsLabel, i18n.options.analyticsOff));

        await vi.waitFor(async () =>
            expect(await storage.getLocal('analyticsClientId')).toBeUndefined(),
        );
        expect(analyticsAtDelete).toEqual([false]);
        expect((await getSettings()).analytics).toBe(false);
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

    // Ф11 audit. The airing watch keeps two caches in storage.local — the
    // snapshot «тайтл → сколько серий вышло» and the rows the badge counts — and
    // both describe this account's lists. A button that says «Очистить кэш» must
    // not leave list data behind just because it was not written to the session.
    it('clears the airing caches of phase 11 too', async () => {
        const { container } = await mountPage();
        await fakeBrowser.storage.local.set({
            airedSnapshot: { '1': 8 },
            badgeBacklog: [{ rateId: '1', episodesAired: 8, progress: 3 }],
        });
        await openSection(container, 2);

        const clear = findAll(container, 'opt__btn').find(
            (el) => textOf(el).trim() === i18n.options.clearCache,
        );
        clickOn(clear!);

        await vi.waitFor(async () =>
            expect(await fakeBrowser.storage.local.get(['airedSnapshot', 'badgeBacklog'])).toEqual(
                {},
            ),
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

    // --- «Новые серии» (Ф11-11, US-12) ----------------------------------------

    describe('the «Новые серии» block', () => {
        // The design card collapses 16 input combinations into five drawings;
        // what is pinned below is exactly that collapse — which rows are alive,
        // what the trailing line says, and when there is no line at all.

        type ChangeListener = (permissions: { permissions?: string[] }) => void;

        let addedListeners: ChangeListener[] = [];
        let removedListeners: ChangeListener[] = [];

        // fakeBrowser throws on the whole permissions surface, so the events are
        // kept by hand — this is what makes «отозвали (или выдали) разрешение в
        // chrome://extensions» testable at all.
        function capturePermissionListeners(): void {
            addedListeners = [];
            removedListeners = [];
            vi.spyOn(fakeBrowser.permissions.onAdded, 'addListener').mockImplementation(
                (listener: unknown) => {
                    addedListeners.push(listener as ChangeListener);
                },
            );
            vi.spyOn(fakeBrowser.permissions.onAdded, 'removeListener').mockImplementation(
                (listener: unknown) => {
                    addedListeners = addedListeners.filter((entry) => entry !== listener);
                },
            );
            vi.spyOn(fakeBrowser.permissions.onRemoved, 'addListener').mockImplementation(
                (listener: unknown) => {
                    removedListeners.push(listener as ChangeListener);
                },
            );
            vi.spyOn(fakeBrowser.permissions.onRemoved, 'removeListener').mockImplementation(
                (listener: unknown) => {
                    removedListeners = removedListeners.filter((entry) => entry !== listener);
                },
            );
        }

        async function openBlock(
            options: Parameters<typeof mountPage>[0] = {},
        ): Promise<FakeElement> {
            const { container } = await mountPage(options);
            await openSection(container, 1);
            return container;
        }

        function rowDisabled(container: FakeElement, ariaLabel: string): boolean[] {
            return findAll(chipRow(container, ariaLabel), 'chip').map(
                (el) => el.props.disabled === true,
            );
        }

        // 2. Both settings on, no permission — what everyone sees right after
        // the update: the feature ships enabled and the permission cannot have
        // been granted yet.
        it('offers the permission button when notifications are on without it', async () => {
            const container = await openBlock();

            expect(activeChip(container, i18n.options.badgeRowLabel)).toBe(i18n.options.badgeOn);
            expect(activeChip(container, i18n.options.notifyRowLabel)).toBe(i18n.options.notifyOn);
            expect(rowDisabled(container, i18n.options.badgeRowLabel)).toEqual([false, false]);
            expect(rowDisabled(container, i18n.options.notifyRowLabel)).toEqual([false, false]);

            await vi.waitFor(() =>
                expect(episodesStatus(container)).toBe(i18n.options.notifyMissing),
            );
            expect(allowButton(container)).toBeDefined();
        });

        // 1. Permission held: the line states the fact and offers nothing.
        it('confirms a granted permission and drops the button', async () => {
            const container = await openBlock({ notificationsGranted: true });

            await vi.waitFor(() =>
                expect(episodesStatus(container)).toBe(i18n.options.notifyGranted),
            );
            expect(allowButton(container)).toBeUndefined();
        });

        // 3. The state the second row exists for: messages off, counter alive.
        // No trailing line at all — the row has already said everything.
        it('says nothing at all when notifications are switched off', async () => {
            const container = await openBlock({
                seed: { episodeNotifications: false },
                notificationsGranted: true,
            });

            await vi.waitFor(() =>
                expect(activeChip(container, i18n.options.notifyRowLabel)).toBe(
                    i18n.options.notifyOff,
                ),
            );
            for (let i = 0; i < 5; i += 1) {
                await nextTick();
            }
            expect(episodesStatus(container)).toBeNull();
            expect(allowButton(container)).toBeUndefined();
            // The counter row is untouched by its subordinate.
            expect(rowDisabled(container, i18n.options.badgeRowLabel)).toEqual([false, false]);
        });

        // 4. Counter off: the notification row goes dead, keeps its stored
        // value, and the reason is both on screen and in the a11y tree.
        it('locks the notification row while the counter is off, keeping its value', async () => {
            const container = await openBlock({ seed: { episodeWatch: false } });

            await vi.waitFor(() =>
                expect(activeChip(container, i18n.options.badgeRowLabel)).toBe(
                    i18n.options.badgeOff,
                ),
            );
            expect(rowDisabled(container, i18n.options.notifyRowLabel)).toEqual([true, true]);
            // Not swapped for «Выключены»: this is the value it returns to.
            expect(activeChip(container, i18n.options.notifyRowLabel)).toBe(i18n.options.notifyOn);
            expect(rowDisabled(container, i18n.options.badgeRowLabel)).toEqual([false, false]);
            expect(episodesStatus(container)).toBe(i18n.options.notifyNeedsBadge);
            expect(chipRow(container, i18n.options.notifyRowLabel).props['aria-describedby']).toBe(
                EPISODES_STATUS_ID,
            );
            expect(allowButton(container)).toBeUndefined();
        });

        it('refuses to write through the locked notification row', async () => {
            const { container, getSettings } = await mountPage({ seed: { episodeWatch: false } });
            await openSection(container, 1);
            await vi.waitFor(() =>
                expect(activeChip(container, i18n.options.badgeRowLabel)).toBe(
                    i18n.options.badgeOff,
                ),
            );

            clickOn(chip(container, i18n.options.notifyRowLabel, i18n.options.notifyOff));

            for (let i = 0; i < 5; i += 1) {
                await nextTick();
            }
            expect((await getSettings()).episodeNotifications).toBe(true);
        });

        // 5. No session: both rows dead, both showing what is stored, and no
        // button — asking for a permission under a feature that stays silent
        // anyway is a promise with nothing behind it.
        it('locks both rows without a session and points at the reason', async () => {
            const container = await openBlock({ auth: { status: 'anonymous' } });

            await vi.waitFor(() =>
                expect(episodesStatus(container)).toBe(i18n.options.episodesNoAuth),
            );
            expect(rowDisabled(container, i18n.options.badgeRowLabel)).toEqual([true, true]);
            expect(rowDisabled(container, i18n.options.notifyRowLabel)).toEqual([true, true]);
            expect(activeChip(container, i18n.options.badgeRowLabel)).toBe(i18n.options.badgeOn);
            expect(activeChip(container, i18n.options.notifyRowLabel)).toBe(i18n.options.notifyOn);
            expect(chipRow(container, i18n.options.badgeRowLabel).props['aria-describedby']).toBe(
                EPISODES_STATUS_ID,
            );
            expect(chipRow(container, i18n.options.notifyRowLabel).props['aria-describedby']).toBe(
                EPISODES_STATUS_ID,
            );
            expect(allowButton(container)).toBeUndefined();
        });

        it('writes both settings, and the counter row never touches the other', async () => {
            const { container, getSettings } = await mountPage();
            await openSection(container, 1);

            clickOn(chip(container, i18n.options.notifyRowLabel, i18n.options.notifyOff));
            await vi.waitFor(async () =>
                expect((await getSettings()).episodeNotifications).toBe(false),
            );
            expect((await getSettings()).episodeWatch).toBe(true);

            clickOn(chip(container, i18n.options.badgeRowLabel, i18n.options.badgeOff));
            await vi.waitFor(async () => expect((await getSettings()).episodeWatch).toBe(false));
            // Subordination is a rendering rule, not a stored one.
            expect((await getSettings()).episodeNotifications).toBe(false);
        });

        // Ф11-13, the direction the case above cannot see: there the messages
        // were already off, so a counter row that wrote BOTH settings changed
        // nothing visible (мутационная проверка — that mutation stayed green).
        // With the messages ON it destroys the value the locked row is supposed
        // to keep, and switching the counter back on would silently return a
        // profile that had notifications to a profile that has none (Ф11-11,
        // «показывает сохранённое значение, а не подменяется на Выключены»).
        it('leaves the notification setting alone when the counter is switched off', async () => {
            const { container, getSettings } = await mountPage();
            await openSection(container, 1);

            clickOn(chip(container, i18n.options.badgeRowLabel, i18n.options.badgeOff));

            await vi.waitFor(async () => expect((await getSettings()).episodeWatch).toBe(false));
            expect((await getSettings()).episodeNotifications).toBe(true);
            // Locked, and still showing the value it returns to.
            expect(rowDisabled(container, i18n.options.notifyRowLabel)).toEqual([true, true]);
            expect(activeChip(container, i18n.options.notifyRowLabel)).toBe(i18n.options.notifyOn);

            clickOn(chip(container, i18n.options.badgeRowLabel, i18n.options.badgeOn));

            await vi.waitFor(async () => expect((await getSettings()).episodeWatch).toBe(true));
            expect((await getSettings()).episodeNotifications).toBe(true);
            expect(rowDisabled(container, i18n.options.notifyRowLabel)).toEqual([false, false]);
        });

        it('asks Chrome from the button and confirms a granted permission', async () => {
            const request = vi
                .spyOn(fakeBrowser.permissions, 'request')
                .mockResolvedValue(true as never);
            const container = await openBlock();
            await vi.waitFor(() => expect(allowButton(container)).toBeDefined());

            clickOn(allowButton(container)!);

            await vi.waitFor(() =>
                expect(episodesStatus(container)).toBe(i18n.options.notifyGranted),
            );
            expect(request).toHaveBeenCalledWith({ permissions: ['notifications'] });
            expect(allowButton(container)).toBeUndefined();
        });

        // A refusal changes nothing on screen, so without the toast the click
        // would look ignored — the whole reason the ask is a button of its own.
        it('says so when Chrome refuses the permission', async () => {
            vi.spyOn(fakeBrowser.permissions, 'request').mockResolvedValue(false as never);
            const container = await openBlock();
            await vi.waitFor(() => expect(allowButton(container)).toBeDefined());

            clickOn(allowButton(container)!);

            await vi.waitFor(() =>
                expect(textOf(find(container, 'toast')).trim()).toBe(i18n.options.notifyDenied),
            );
            // The row stays on: the setting was never the thing that failed.
            expect(activeChip(container, i18n.options.notifyRowLabel)).toBe(i18n.options.notifyOn);
            expect(episodesStatus(container)).toBe(i18n.options.notifyMissing);
            expect(allowButton(container)).toBeDefined();
        });

        // Revoked from chrome://extensions with the page open: without the
        // subscription it would keep promising notifications forever.
        it('takes back the confirmation when the permission is revoked', async () => {
            capturePermissionListeners();
            const container = await openBlock({ notificationsGranted: true });
            await vi.waitFor(() =>
                expect(episodesStatus(container)).toBe(i18n.options.notifyGranted),
            );

            for (const listener of [...removedListeners]) {
                listener({ permissions: ['notifications'] });
            }

            await vi.waitFor(() =>
                expect(episodesStatus(container)).toBe(i18n.options.notifyMissing),
            );
            expect(allowButton(container)).toBeDefined();
        });

        // The other direction, found by the review of Ф11-10: granted from
        // chrome://extensions with this tab open. Without onAdded the block would
        // go on claiming «разрешения нет» and offering a button that opens a
        // dialog for a permission the profile already has.
        it('confirms the permission granted outside the page', async () => {
            capturePermissionListeners();
            const container = await openBlock({ notificationsGranted: false });
            await vi.waitFor(() =>
                expect(episodesStatus(container)).toBe(i18n.options.notifyMissing),
            );

            for (const listener of [...addedListeners]) {
                listener({ permissions: ['notifications'] });
            }

            await vi.waitFor(() =>
                expect(episodesStatus(container)).toBe(i18n.options.notifyGranted),
            );
            expect(allowButton(container)).toBeUndefined();
        });
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

        // --- the panel itself (Ф8-2) ------------------------------------------

        const BOOSTY = 'https://boosty.to/shikifav';
        const boosty: DonationMethod = {
            id: 'boosty',
            label: 'Boosty',
            hint: 'разовый или регулярный донат',
            url: BOOSTY,
        };

        it('renders the ways to pay from the config, each opening in a new tab', async () => {
            const { container } = await mountPage({
                donations: { methods: [boosty], actions: [{ id: 'share' }] },
            });
            await openSection(container, 3);

            expect(panelLabels(container)).toEqual([
                i18n.options.supportLabel,
                i18n.options.helpLabel,
            ]);
            // The intro belongs to the first block alone.
            expect(panelHints(container)).toEqual([i18n.options.supportHint]);
            expect(supportRows(container)).toEqual([
                'Boosty — разовый или регулярный донат',
                `${i18n.options.helpShare} — ${i18n.options.helpShareNote}`,
            ]);

            const link = find(container, 'sup__name');
            expect(link.tag).toBe('a');
            expect(link.props.href).toBe(BOOSTY);
            // A tab of the store or a payment page must not be able to reach
            // back into this page.
            expect(link.props.target).toBe('_blank');
            expect(link.props.rel).toBe('noopener noreferrer');
        });

        // An empty list of methods is a state, not a placeholder: no block, no
        // «пока ничего нет», and the heading of the free block loses its «ещё».
        it('drops the whole block of methods when there is none', async () => {
            const { container } = await mountPage({
                donations: { methods: [], actions: [{ id: 'share' }] },
            });
            await openSection(container, 3);

            expect(panelLabels(container)).toEqual([i18n.options.supportEmptyLabel]);
            expect(panelHints(container)).toEqual([i18n.options.supportEmptyHint]);
            expect(findAll(container, 'sup')).toHaveLength(1);
            expect(supportRows(container)).toEqual([
                `${i18n.options.helpShare} — ${i18n.options.helpShareNote}`,
            ]);
        });

        it('renders an entry without an address as text, not as a dead link', async () => {
            const { container } = await mountPage({
                donations: {
                    methods: [],
                    actions: [{ id: 'share' }, { id: 'bug', url: 'https://github.test/issues' }],
                },
            });
            await openSection(container, 3);

            const [share, bug] = findAll(container, 'sup__item').map((el) => find(el, 'sup__name'));
            expect(share.tag).toBe('span');
            expect(share.props.href).toBeUndefined();
            expect(textOf(share).trim()).toBe(i18n.options.helpShare);

            expect(bug.tag).toBe('a');
            expect(bug.props.href).toBe('https://github.test/issues');
        });

        // The url is hand-edited text: only https reaches an href
        // (src/lib/external-url.ts). Ф8-6: for a payment method that is the end
        // of it — a place nobody can pay through is no offer, so it is not
        // shown as text either, the way a free ask without a link is.
        it('leaves a method with an unusable address out of the list', async () => {
            const { container } = await mountPage({
                donations: {
                    methods: [
                        boosty,
                        { ...boosty, id: 'dead', label: 'Касса', url: 'http://boosty.to/x' },
                    ],
                    actions: [{ id: 'share' }],
                },
            });
            await openSection(container, 3);

            expect(supportRows(container)).toEqual([
                'Boosty — разовый или регулярный донат',
                `${i18n.options.helpShare} — ${i18n.options.helpShareNote}`,
            ]);
            // The live method is a link, the free ask is text — and nothing else
            // is rendered at all.
            expect(findAll(container, 'sup__name').map((el) => el.tag)).toEqual(['a', 'span']);
        });

        // The two lists are rendered through two different guards, and a bare
        // mailto: is exactly where they part: the report line among the free
        // asks is a live link, the same address as a way to PAY is not — there
        // is no cash desk over mail. Both in one mount, because what is under
        // test is the difference: were the section to render methods through
        // the mail-tolerant guard of the free asks, the row below would appear.
        it('leaves a mail address out of the cash desk though a free ask keeps it', async () => {
            const { container } = await mountPage({
                donations: {
                    methods: [{ ...boosty, id: 'mail', label: 'Почта', url: 'mailto:pay@y.test' }],
                    actions: [{ id: 'bug', url: 'mailto:x@y.test' }],
                },
            });
            await openSection(container, 3);

            // No method survived, so the block is gone and the free one takes
            // over the heading — the same state as a config with no methods.
            expect(panelLabels(container)).toEqual([i18n.options.supportEmptyLabel]);
            expect(supportRows(container)).toEqual([
                `${i18n.options.helpBug} — ${i18n.options.helpBugNote}`,
            ]);
            // The one row left is the free ask, and it IS a link: the address
            // was refused for being a cash desk, not for being unusable.
            expect(find(container, 'sup__name').props.href).toBe('mailto:x@y.test');
        });

        it('drops the block when the only method has no live address', async () => {
            const { container } = await mountPage({
                donations: {
                    methods: [{ ...boosty, url: 'javascript:alert(1)' }],
                    actions: [{ id: 'share' }],
                },
            });
            await openSection(container, 3);

            // Same state as no methods at all: no block, and the free one takes
            // over the heading.
            expect(panelLabels(container)).toEqual([i18n.options.supportEmptyLabel]);
            expect(supportRows(container)).toEqual([
                `${i18n.options.helpShare} — ${i18n.options.helpShareNote}`,
            ]);
        });

        // The report line is a mailto: address (the repository is not public,
        // so a letter is the only way through), and it is rendered exactly like
        // every other line of the section — new tab, rel, glyph.
        //
        // It used to be the exception, on the reasoning that target="_blank" on
        // a mailto: leaves an empty tab hanging when no mail handler is
        // registered. The owner's smoke of 2026-08-10 showed the other half of
        // that trade: with a web handler registered for mailto: (Gmail), a link
        // WITHOUT target navigates the settings tab itself onto a compose form,
        // and the settings are gone. An empty tab for whoever has no handler is
        // the smaller loss, so the exception was dropped — do not «fix» this
        // test back to promising no new tab.
        //
        // Both rows in one mount on purpose: after the branch was removed, an
        // https row rendered beside the mail one is what shows the two really
        // agree, instead of the attributes having quietly gone missing from
        // both.
        it('renders a mail address as a link into a new tab, like every other line', async () => {
            const { container } = await mountPage({
                donations: {
                    methods: [],
                    actions: [
                        { id: 'bug', url: 'mailto:x@y.test' },
                        { id: 'review', needsUrl: true, url: 'https://store.test/x' },
                    ],
                },
            });
            await openSection(container, 3);

            const [mail, web] = findAll(container, 'sup__item');

            const mailLink = find(mail, 'sup__name');
            expect(mailLink.tag).toBe('a');
            expect(mailLink.props.href).toBe('mailto:x@y.test');
            expect(mailLink.props.target).toBe('_blank');
            expect(mailLink.props.rel).toBe('noopener noreferrer');
            expect(findAll(mail, 'sup__ext')).toHaveLength(1);

            const webLink = find(web, 'sup__name');
            expect(webLink.props.href).toBe('https://store.test/x');
            expect(webLink.props.target).toBe('_blank');
            expect(webLink.props.rel).toBe('noopener noreferrer');
            expect(findAll(web, 'sup__ext')).toHaveLength(1);
        });

        // Data, not a v-if by id: filling the url in donations.ts is the whole
        // job of showing the entry once the extension is published.
        it('hides an action that is nothing but a link until it has an address', async () => {
            const hidden = await mountPage({
                donations: { methods: [], actions: [{ id: 'review', needsUrl: true }] },
            });
            await openSection(hidden.container, 3);
            expect(supportRows(hidden.container)).toEqual([]);

            const shown = await mountPage({
                donations: {
                    methods: [],
                    actions: [{ id: 'review', needsUrl: true, url: 'https://store.test/x' }],
                },
            });
            await openSection(shown.container, 3);
            expect(supportRows(shown.container)).toEqual([
                `${i18n.options.helpReview} — ${i18n.options.helpReviewNote}`,
            ]);
            expect(find(shown.container, 'sup__name').props.href).toBe('https://store.test/x');
        });
    });
});
