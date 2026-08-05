import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import type { User } from '@/src/lib/api/types';
import type { SessionState } from '@/src/lib/storage';
import { i18n } from '@/src/lib/i18n';
import { clickOn, createApp, createFakeElement, findAll } from './fake-renderer';
import type { FakeElement } from './fake-renderer';

// Shell header: avatar, nickname and the icon actions. Ф8-3 added the third one
// — ♥ opens the options page on its «Поддержать» section, handing the section
// over through a one-shot session key, because openOptionsPage() only focuses
// an already open options tab and would ignore a URL.
//
// Every case rebuilds the module graph (use-auth keeps module state) and reads
// storage through the SAME graph the component is mounted from.

const USER: User = { id: 1, nickname: 'tester', avatarUrl: 'https://cdn.test/x160.png' };

interface Mounted {
    container: FakeElement;
    getSession: <K extends keyof SessionState>(key: K) => Promise<SessionState[K] | undefined>;
}

let cleanups: Array<() => void> = [];

// No background listener is registered on purpose: useAuth() only needs the
// header to render, and a failed auth.getState leaves it in the anonymous state
// the component does not draw anything from.
async function mountHeader(user: User = USER): Promise<Mounted> {
    vi.resetModules();
    const storage = await import('@/src/lib/storage');
    const { default: UserHeader } = await import('@/src/components/UserHeader.vue');

    const container = createFakeElement('#container');
    const app = createApp(UserHeader, { user });
    app.mount(container);
    cleanups.push(() => app.unmount());

    return { container, getSession: storage.getSession };
}

function buttons(container: FakeElement): FakeElement[] {
    return findAll(container, 'header__btn');
}

// By accessible name, not by position: the order of the icons is a design
// decision and must be free to change without rewriting these tests.
function button(container: FakeElement, name: string): FakeElement {
    const found = buttons(container).find((el) => el.props['aria-label'] === name);
    if (!found) {
        throw new Error(`no header button named "${name}"`);
    }
    return found;
}

describe('UserHeader', () => {
    beforeEach(() => {
        fakeBrowser.reset();
    });

    afterEach(() => {
        for (const cleanup of cleanups) {
            cleanup();
        }
        cleanups = [];
        // fakeBrowser.reset() does not undo a spy, and openOptionsPage is
        // stubbed in most cases here.
        vi.restoreAllMocks();
    });

    it('renders three named icon actions', async () => {
        const { container } = await mountHeader();

        const names = buttons(container).map((el) => el.props['aria-label']);
        expect(names).toHaveLength(3);
        expect(names).toContain(i18n.header.support);
        expect(names).toContain(i18n.header.settings);
        expect(names).toContain(i18n.header.logout);
        // An icon-only button needs both: the title is the hover hint, the
        // aria-label is the name.
        for (const el of buttons(container)) {
            expect(el.props.title).toBe(el.props['aria-label']);
        }
    });

    it('hands the support section over BEFORE opening the options page', async () => {
        const { container, getSession } = await mountHeader();
        let sectionAtOpen: string | undefined;
        const openOptionsPage = vi
            .spyOn(fakeBrowser.runtime, 'openOptionsPage')
            .mockImplementation(async () => {
                // The page reads the key while mounting, so it has to be in
                // storage by the time the tab opens.
                sectionAtOpen = await getSession('pendingOptionsSection');
            });

        clickOn(button(container, i18n.header.support));

        await vi.waitFor(() => expect(openOptionsPage).toHaveBeenCalledOnce());
        expect(sectionAtOpen).toBe('support');
    });

    it('opens the options page even when the handover cannot be written', async () => {
        const { container } = await mountHeader();
        vi.spyOn(fakeBrowser.storage.session, 'set').mockRejectedValue(new Error('storage is off'));
        const openOptionsPage = vi
            .spyOn(fakeBrowser.runtime, 'openOptionsPage')
            .mockResolvedValue(undefined);

        clickOn(button(container, i18n.header.support));

        // The jump is lost, the settings are not: the page opens on «Вид».
        await vi.waitFor(() => expect(openOptionsPage).toHaveBeenCalledOnce());
    });

    // Ф8-6: the key is one-shot and is consumed by the page it opens. If no page
    // opened, it has to go — otherwise the next ⚙ lands on «Поддержать» without
    // anyone asking for it.
    it('drops the handover when the options page refuses to open', async () => {
        const { container, getSession } = await mountHeader();
        vi.spyOn(console, 'debug').mockImplementation(() => {});
        const openOptionsPage = vi
            .spyOn(fakeBrowser.runtime, 'openOptionsPage')
            .mockRejectedValue(new Error('no active window'));

        clickOn(button(container, i18n.header.support));

        await vi.waitFor(() => expect(openOptionsPage).toHaveBeenCalledOnce());
        await vi.waitFor(async () =>
            expect(await getSession('pendingOptionsSection')).toBeUndefined(),
        );
    });

    it('opens the settings without asking for a section', async () => {
        const { container, getSession } = await mountHeader();
        const openOptionsPage = vi
            .spyOn(fakeBrowser.runtime, 'openOptionsPage')
            .mockResolvedValue(undefined);

        clickOn(button(container, i18n.header.settings));

        expect(openOptionsPage).toHaveBeenCalledOnce();
        // ⚙ must land on «Вид», not on the section ♥ asked for last time.
        expect(await getSession('pendingOptionsSection')).toBeUndefined();
    });

    it('draws an img for an avatar it has', async () => {
        const { container } = await mountHeader();

        const avatar = findAll(container, 'header__avatar');
        expect(avatar).toHaveLength(1);
        expect(avatar[0].tag).toBe('img');
        expect(avatar[0].props.src).toBe(USER.avatarUrl);
    });

    it('falls back to the neutral circle instead of a broken image', async () => {
        // Empty is what whoami() and getAuthState() produce for an avatar the
        // https guard rejected, not only for an account without a picture.
        const { container } = await mountHeader({ ...USER, avatarUrl: '' });

        const avatar = findAll(container, 'header__avatar');
        expect(avatar).toHaveLength(1);
        expect(avatar[0].tag).not.toBe('img');
        expect(avatar[0].props.src).toBeUndefined();
    });
});
