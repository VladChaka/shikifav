import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h, nextTick } from 'vue';
import type { Component } from 'vue';
import XSelect from './XSelect.vue';
import type { XSelectOption } from './XSelect.vue';
import {
    clickOn,
    createApp,
    createFakeElement,
    find,
    findAll,
    fire,
    textOf,
} from './fake-renderer';
import type { FakeElement, FakeNode } from './fake-renderer';

// XSelect is mounted through the shared in-memory harness (fake-renderer.ts):
// DOM events are dispatched by invoking the listeners the template attached
// via patchProp, and the document-level click listener is captured through a
// stubbed global.

interface FakeKeyboardEvent {
    key: string;
    preventDefault: ReturnType<typeof vi.fn>;
}

function keydownOn(el: FakeElement, key: string): FakeKeyboardEvent {
    const event: FakeKeyboardEvent = { key, preventDefault: vi.fn() };
    fire(el, 'keydown', event);
    return event;
}

// --- document stub (outside-click handling) --------------------------------

type DocumentClickListener = (event: MouseEvent) => void;

let documentClickListeners: Set<DocumentClickListener>;

function dispatchDocumentClick(target: FakeNode): void {
    for (const listener of [...documentClickListeners]) {
        listener({ target } as unknown as MouseEvent);
    }
}

// --- mounting ---------------------------------------------------------------

interface MountProps {
    options: readonly XSelectOption<string>[];
    modelValue: string;
    statusDots?: boolean;
    ariaLabel?: string;
}

interface Mounted {
    container: FakeElement;
    emitted: string[];
    unmount: () => void;
}

let cleanups: Array<() => void> = [];

function mountSelect(props: MountProps): Mounted {
    const emitted: string[] = [];
    const container = createFakeElement('#container');
    const app = createApp({
        render: () =>
            // The generic constructor type of a generic SFC is not directly
            // assignable to Component, hence the cast; runtime props are the
            // exact MountProps contract.
            h(XSelect as unknown as Component, {
                ...props,
                'onUpdate:modelValue': (value: string) => {
                    emitted.push(value);
                },
            }),
    });
    app.mount(container);
    let unmounted = false;
    const unmount = (): void => {
        if (!unmounted) {
            unmounted = true;
            app.unmount();
        }
    };
    cleanups.push(unmount);
    return { container, emitted, unmount };
}

const OPTIONS: readonly XSelectOption<string>[] = [
    { value: 'anime', label: 'Anime' },
    { value: 'manga', label: 'Manga', disabled: true },
    { value: 'ranobe', label: 'Ranobe' },
];

function trigger(container: FakeNode): FakeElement {
    return find(container, 'xselect');
}

function menuIsOpen(container: FakeNode): boolean {
    return findAll(container, 'xselect__menu').length > 0;
}

function activeOptionText(container: FakeNode): string {
    return textOf(find(container, 'xselect__opt--active'));
}

async function mountOpen(props: MountProps): Promise<Mounted> {
    const mounted = mountSelect(props);
    clickOn(trigger(mounted.container));
    await nextTick();
    return mounted;
}

// --- tests ------------------------------------------------------------------

beforeEach(() => {
    documentClickListeners = new Set();
    vi.stubGlobal('document', {
        addEventListener: (type: string, listener: DocumentClickListener) => {
            if (type === 'click') {
                documentClickListeners.add(listener);
            }
        },
        removeEventListener: (_type: string, listener: DocumentClickListener) => {
            documentClickListeners.delete(listener);
        },
    });
});

afterEach(() => {
    for (const cleanup of cleanups) {
        cleanup();
    }
    cleanups = [];
    vi.unstubAllGlobals();
});

describe('XSelect', () => {
    it('renders the selected label, aria attributes and no menu while closed', () => {
        const { container } = mountSelect({
            options: OPTIONS,
            modelValue: 'ranobe',
            ariaLabel: 'Type filter',
        });
        const button = trigger(container);
        expect(textOf(find(container, 'xselect__val'))).toBe('Ranobe');
        expect(button.props['aria-expanded']).toBe(false);
        expect(button.props['aria-label']).toBe('Type filter');
        expect(menuIsOpen(container)).toBe(false);
    });

    it('opens on trigger click and closes on a second click', async () => {
        const { container } = mountSelect({ options: OPTIONS, modelValue: 'anime' });
        const button = trigger(container);

        clickOn(button);
        await nextTick();
        expect(menuIsOpen(container)).toBe(true);
        expect(button.props['aria-expanded']).toBe(true);
        expect(findAll(container, 'xselect__opt')).toHaveLength(3);

        clickOn(button);
        await nextTick();
        expect(menuIsOpen(container)).toBe(false);
        expect(button.props['aria-expanded']).toBe(false);
    });

    it('marks the current option as selected and highlights it on open', async () => {
        const { container } = await mountOpen({ options: OPTIONS, modelValue: 'ranobe' });
        const selected = find(container, 'xselect__opt--selected');
        expect(textOf(selected)).toContain('Ranobe');
        expect(selected.props['aria-selected']).toBe(true);
        expect(findAll(selected, 'xselect__check')).toHaveLength(1);
        expect(activeOptionText(container)).toContain('Ranobe');
    });

    it('links the trigger to the menu and the highlighted option via aria ids', async () => {
        const { container } = mountSelect({ options: OPTIONS, modelValue: 'anime' });
        const button = trigger(container);
        expect(button.props['aria-controls']).toBeUndefined();
        expect(button.props['aria-activedescendant']).toBeUndefined();

        clickOn(button);
        await nextTick();
        const menu = find(container, 'xselect__menu');
        expect(typeof menu.props.id).toBe('string');
        expect(menu.props.id).toBeTruthy();
        expect(button.props['aria-controls']).toBe(menu.props.id);
        expect(button.props['aria-activedescendant']).toBe(
            find(container, 'xselect__opt--active').props.id,
        );

        // The link follows the keyboard highlight.
        keydownOn(button, 'ArrowDown');
        await nextTick();
        const active = find(container, 'xselect__opt--active');
        expect(textOf(active)).toContain('Ranobe');
        expect(button.props['aria-activedescendant']).toBe(active.props.id);

        keydownOn(button, 'Escape');
        await nextTick();
        expect(button.props['aria-controls']).toBeUndefined();
        expect(button.props['aria-activedescendant']).toBeUndefined();
    });

    it('emits update:modelValue and closes when picking another option', async () => {
        const { container, emitted } = await mountOpen({ options: OPTIONS, modelValue: 'anime' });
        const ranobe = findAll(container, 'xselect__opt')[2]!;
        clickOn(ranobe);
        await nextTick();
        expect(emitted).toEqual(['ranobe']);
        expect(menuIsOpen(container)).toBe(false);
    });

    it('closes without emitting when re-picking the current value', async () => {
        const { container, emitted } = await mountOpen({ options: OPTIONS, modelValue: 'anime' });
        const anime = findAll(container, 'xselect__opt')[0]!;
        clickOn(anime);
        await nextTick();
        expect(emitted).toEqual([]);
        expect(menuIsOpen(container)).toBe(false);
    });

    it('ignores clicks on disabled options and keeps the menu open', async () => {
        const { container, emitted } = await mountOpen({ options: OPTIONS, modelValue: 'anime' });
        const manga = find(container, 'xselect__opt--disabled');
        expect(manga.props['aria-disabled']).toBe(true);
        clickOn(manga);
        await nextTick();
        expect(emitted).toEqual([]);
        expect(menuIsOpen(container)).toBe(true);
    });

    it('closes on Escape and prevents the default action', async () => {
        const { container } = await mountOpen({ options: OPTIONS, modelValue: 'anime' });
        const event = keydownOn(trigger(container), 'Escape');
        await nextTick();
        expect(event.preventDefault).toHaveBeenCalledOnce();
        expect(menuIsOpen(container)).toBe(false);
    });

    it('closes on a click outside but stays open on a click inside', async () => {
        const { container } = await mountOpen({ options: OPTIONS, modelValue: 'anime' });
        expect(documentClickListeners.size).toBe(1);

        dispatchDocumentClick(trigger(container));
        await nextTick();
        expect(menuIsOpen(container)).toBe(true);

        dispatchDocumentClick(createFakeElement('outside'));
        await nextTick();
        expect(menuIsOpen(container)).toBe(false);
        expect(documentClickListeners.size).toBe(0);
    });

    it.each([
        ['an element outside the root', (): FakeElement | null => createFakeElement('outside')],
        ['nothing (focus left the window)', (): FakeElement | null => null],
    ])('closes on focusout when focus moves to %s', async (_name, makeTarget) => {
        const { container } = await mountOpen({ options: OPTIONS, modelValue: 'anime' });
        fire(find(container, 'xselect-root'), 'focusout', { relatedTarget: makeTarget() });
        await nextTick();
        expect(menuIsOpen(container)).toBe(false);
    });

    it('stays open on focusout when focus moves within the root', async () => {
        const { container } = await mountOpen({ options: OPTIONS, modelValue: 'anime' });
        fire(find(container, 'xselect-root'), 'focusout', {
            relatedTarget: trigger(container),
        });
        await nextTick();
        expect(menuIsOpen(container)).toBe(true);
    });

    it('prevents default on menu mousedown so an option click keeps the focus', async () => {
        const { container } = await mountOpen({ options: OPTIONS, modelValue: 'anime' });
        const event = { preventDefault: vi.fn() };
        fire(find(container, 'xselect__menu'), 'mousedown', event);
        expect(event.preventDefault).toHaveBeenCalledOnce();
    });

    it('removes the document click listener on unmount while open', async () => {
        const { unmount } = await mountOpen({ options: OPTIONS, modelValue: 'anime' });
        expect(documentClickListeners.size).toBe(1);
        unmount();
        expect(documentClickListeners.size).toBe(0);
    });

    it.each([['ArrowDown'], ['ArrowUp']])(
        'opens the menu on %s while closed and highlights the current value',
        async (key) => {
            const { container } = mountSelect({ options: OPTIONS, modelValue: 'ranobe' });
            const event = keydownOn(trigger(container), key);
            await nextTick();
            expect(event.preventDefault).toHaveBeenCalledOnce();
            expect(menuIsOpen(container)).toBe(true);
            expect(activeOptionText(container)).toContain('Ranobe');
        },
    );

    it('moves the highlight with arrows, skipping disabled options and wrapping', async () => {
        const { container } = await mountOpen({ options: OPTIONS, modelValue: 'anime' });
        const button = trigger(container);
        expect(activeOptionText(container)).toContain('Anime');

        // Down from Anime skips disabled Manga.
        keydownOn(button, 'ArrowDown');
        await nextTick();
        expect(activeOptionText(container)).toContain('Ranobe');

        // Down from the last option wraps to the first.
        keydownOn(button, 'ArrowDown');
        await nextTick();
        expect(activeOptionText(container)).toContain('Anime');

        // Up from the first option wraps backwards, again skipping Manga.
        keydownOn(button, 'ArrowUp');
        await nextTick();
        expect(activeOptionText(container)).toContain('Ranobe');
    });

    it.each([
        ['Enter', 'Enter'],
        ['Space', ' '],
    ])('picks the highlighted option with %s', async (_name, key) => {
        const { container, emitted } = await mountOpen({ options: OPTIONS, modelValue: 'anime' });
        const button = trigger(container);
        keydownOn(button, 'ArrowDown');
        await nextTick();

        const event = keydownOn(button, key);
        await nextTick();
        expect(event.preventDefault).toHaveBeenCalledOnce();
        expect(emitted).toEqual(['ranobe']);
        expect(menuIsOpen(container)).toBe(false);
    });

    it('leaves Enter on the closed trigger to the native button click', async () => {
        const { container } = mountSelect({ options: OPTIONS, modelValue: 'anime' });
        const button = trigger(container);

        // The handler must not swallow the key: the browser turns it into a
        // native click on the <button>, which is what opens the menu.
        const event = keydownOn(button, 'Enter');
        await nextTick();
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(menuIsOpen(container)).toBe(false);

        clickOn(button); // what the native activation would do
        await nextTick();
        expect(menuIsOpen(container)).toBe(true);
    });

    it('moves the highlight to the hovered option on mousemove', async () => {
        const { container } = await mountOpen({ options: OPTIONS, modelValue: 'anime' });
        const ranobe = findAll(container, 'xselect__opt')[2]!;
        fire(ranobe, 'mousemove', { target: ranobe });
        await nextTick();
        expect(activeOptionText(container)).toContain('Ranobe');
    });

    it('does not move the highlight on mousemove over a disabled option', async () => {
        const { container } = await mountOpen({ options: OPTIONS, modelValue: 'anime' });
        expect(activeOptionText(container)).toContain('Anime');
        const manga = find(container, 'xselect__opt--disabled');
        fire(manga, 'mousemove', { target: manga });
        await nextTick();
        expect(activeOptionText(container)).toContain('Anime');
    });

    it('renders st-* status dots on the trigger and options when statusDots is set', async () => {
        const statuses: readonly XSelectOption<string>[] = [
            { value: 'watching', label: 'Watching' },
            { value: 'completed', label: 'Completed' },
        ];
        const { container } = await mountOpen({
            options: statuses,
            modelValue: 'watching',
            statusDots: true,
        });

        const triggerDot = find(container, 'xselect__fdot');
        expect(typeof triggerDot.props.class).toBe('string');
        expect((triggerDot.props.class as string).split(/\s+/)).toContain('st-watching');

        const optionClasses = findAll(container, 'xselect__opt').map((option) =>
            (option.props.class as string).split(/\s+/),
        );
        expect(optionClasses[0]).toContain('st-watching');
        expect(optionClasses[1]).toContain('st-completed');
        expect(findAll(container, 'xselect__dot')).toHaveLength(2);
    });

    it('renders no status dot on the trigger without statusDots', () => {
        const { container } = mountSelect({ options: OPTIONS, modelValue: 'anime' });
        expect(findAll(container, 'xselect__fdot')).toHaveLength(0);
    });
});
