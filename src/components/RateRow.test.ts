import { afterEach, describe, expect, it, vi } from 'vitest';
import { h, nextTick } from 'vue';
import type { Component } from 'vue';
import RateRowView from './RateRow.vue';
import type { RateRow } from '@/src/lib/api/types';
import { i18n } from '@/src/lib/i18n';
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

// Ф6-26: a list row links to the title page from its poster and its name, the
// same contract as TitleCard. What matters extra here is that the link does not
// take over the row controls — [+1], the score button and the status badge keep
// working (they sit outside the linked areas). Mounted through the shared fake
// renderer.

const TITLE_URL = 'https://shikimori.io/animes/52991-sousou-no-frieren';

function row(overrides: Partial<RateRow> = {}): RateRow {
    return {
        rateId: '311',
        targetId: '52991',
        targetType: 'Anime',
        name: 'Sousou no Frieren',
        russian: 'Провожающая в последний путь Фрирен',
        posterUrl: 'https://desu.shikimori.one/uploads/poster/animes/52991/mini.webp',
        posterUrl2x: 'https://desu.shikimori.one/uploads/poster/animes/52991/mini@2x.webp',
        status: 'watching',
        score: 8,
        progress: 27,
        total: 28,
        url: TITLE_URL,
        ...overrides,
    };
}

interface Mounted {
    container: FakeElement;
    events: string[];
}

let cleanups: Array<() => void> = [];

// The score and status buttons carry @click.stop, so the event stub needs the
// method Vue's `stop` modifier calls (the shared clickOn passes a bare target).
function click(el: FakeElement): void {
    fire(el, 'click', { target: el, stopPropagation: () => {} });
}

function mountRow(data: RateRow): Mounted {
    const events: string[] = [];
    const container = createFakeElement('#container');
    const app = createApp({
        render: () =>
            // Same SFC-to-Component cast as in the other component tests;
            // runtime props are the exact RateRow contract.
            h(RateRowView as unknown as Component, {
                rate: data,
                busy: false,
                suggestCompleted: false,
                onIncrement: () => events.push('increment'),
                'onUpdate:scoreOpen': (open: boolean) => events.push(`score:${String(open)}`),
                'onUpdate:statusOpen': (open: boolean) => events.push(`status:${String(open)}`),
            }),
    });
    app.mount(container);
    cleanups.push(() => app.unmount());
    return { container, events };
}

afterEach(() => {
    for (const cleanup of cleanups) {
        cleanup();
    }
    cleanups = [];
});

describe('RateRow title page links (Ф6-26)', () => {
    it('renders the poster as a new-tab link to the title page', () => {
        const box = find(mountRow(row()).container, 'rate__poster-box');
        expect(box.tag).toBe('a');
        expect(box.props.href).toBe(TITLE_URL);
        expect(box.props.target).toBe('_blank');
        expect(box.props.rel).toBe('noopener noreferrer');
        expect(box.props.tabindex).toBe('-1');
        expect(box.props['aria-hidden']).toBe('true');
    });

    it('renders the name as a new-tab link inside the heading', () => {
        const { container } = mountRow(row());
        const link = find(container, 'rate__title-link');
        expect(link.tag).toBe('a');
        expect(link.props.href).toBe(TITLE_URL);
        expect(link.props.target).toBe('_blank');
        expect(link.props.rel).toBe('noopener noreferrer');

        const heading = find(container, 'rate__title');
        expect(heading.tag).toBe('h3');
        expect(textOf(heading).trim()).toBe('Провожающая в последний путь Фрирен');
    });

    it('renders a row from an older session cache (no url) without links', () => {
        const noUrl = row();
        delete noUrl.url;
        const { container } = mountRow(noUrl);

        const box = find(container, 'rate__poster-box');
        expect(box.tag).toBe('div');
        expect(box.props.href).toBeUndefined();
        expect(findAll(container, 'rate__title-link')).toHaveLength(0);
        expect(find(container, 'rate__poster').props.src).toBe(row().posterUrl);
        expect(textOf(find(container, 'rate__title')).trim()).toBe(
            'Провожающая в последний путь Фрирен',
        );
    });

    // Ф6-27: same poster chain as in TitleCard, ending in the bundled image.
    it('falls back to the local image when the row has no poster', () => {
        const { container } = mountRow(row({ posterUrl: null, posterUrl2x: null }));
        const poster = find(container, 'rate__poster');
        expect(poster.tag).toBe('img');
        expect(String(poster.props.src)).toContain('poster-fallback');
        expect(poster.props.srcset).toBeUndefined();
        // Unchanged 42x58 box.
        expect(poster.props.width).toBe('42');
        expect(poster.props.height).toBe('58');
    });

    it('uses a backfilled poster with no 2x pair as a plain src', () => {
        const backfilled = 'https://shikimori.io/system/animes/x96/1342.jpg?1711979744';
        const { container } = mountRow(row({ posterUrl: backfilled, posterUrl2x: null }));
        const poster = find(container, 'rate__poster');
        expect(poster.props.src).toBe(backfilled);
        expect(poster.props.srcset).toBeUndefined();
    });

    it('keeps a non-https url out of href', () => {
        for (const url of ['javascript:alert(1)', 'http://shikimori.io/animes/52991', 'nonsense']) {
            const { container } = mountRow(row({ url }));
            const box = find(container, 'rate__poster-box');
            expect(box.tag).toBe('div');
            expect(box.props.href).toBeUndefined();
            expect(findAll(container, 'rate__title-link')).toHaveLength(0);
        }
    });

    it('leaves the row controls outside the links: [+1], score and badge still fire', () => {
        const { container, events } = mountRow(row());
        click(find(container, 'rate__inc'));
        click(find(container, 'rate__score-btn'));
        click(find(container, 'rate__badge'));
        expect(events).toEqual(['increment', 'score:true', 'status:true']);
        // None of the three sits inside a link.
        for (const className of ['rate__inc', 'rate__score-btn', 'rate__badge']) {
            expect(findAll(find(container, 'rate__poster-box'), className)).toHaveLength(0);
            expect(findAll(find(container, 'rate__title-link'), className)).toHaveLength(0);
        }
    });
});

// --- Ф7-16: inline progress editor ------------------------------------------
// The row is still presentational: it owns open/closed and the draft text, and
// emits one absolute number. Everything below is that contract — the phrase
// trigger, the keyboard, the in-row validation and what leaves the component.

interface EditorMount {
    container: FakeElement;
    // Values of set-progress, in order.
    written: number[];
}

function mountEditor(data: RateRow, busy = false): EditorMount {
    const written: number[] = [];
    const container = createFakeElement('#container');
    const app = createApp({
        render: () =>
            h(RateRowView as unknown as Component, {
                rate: data,
                busy,
                suggestCompleted: false,
                onSetProgress: (value: number) => written.push(value),
            }),
    });
    app.mount(container);
    cleanups.push(() => app.unmount());
    return { container, written };
}

// The fake element carries no DOM value property, so the event brings its own
// target: the handler reads it and writes the filtered text back into it.
function typeInto(input: FakeElement, value: string): { value: string } {
    const target = { value };
    fire(input, 'input', { target });
    return target;
}

function keydownOn(el: FakeElement, key: string): void {
    fire(el, 'keydown', { key, preventDefault: vi.fn() });
}

// Click the phrase and let the field render (its focus/select run in the same
// nextTick, before the one awaited here).
async function openEditor(container: FakeElement): Promise<FakeElement> {
    clickOn(find(container, 'rate__progress-btn'));
    await nextTick();
    return find(container, 'rate__progress-input');
}

function classesOf(el: FakeElement): string[] {
    return typeof el.props.class === 'string' ? el.props.class.split(/\s+/) : [];
}

describe('RateRow progress editor (Ф7-16)', () => {
    it('shows the phrase as the trigger and no field at rest', () => {
        const { container } = mountEditor(row({ progress: 5, total: 11 }));
        const trigger = find(container, 'rate__progress-btn');
        expect(trigger.tag).toBe('button');
        // The visible phrase does not work as an accessible name.
        expect(trigger.props['aria-label']).toBe(i18n.rates.editProgress);
        expect(trigger.props.title).toBe(i18n.rates.editProgress);
        expect(textOf(find(container, 'rate__progress-value'))).toBe('5');
        expect(textOf(find(container, 'rate__progress-tail'))).toBe('/ 11 эп.');
        expect(findAll(container, 'rate__progress-input')).toHaveLength(0);
    });

    it('opens the field focused, preselected and seeded with the current value', async () => {
        const { container } = mountEditor(row({ progress: 5, total: 11 }));
        const input = await openEditor(container);
        expect(input.tag).toBe('input');
        expect(input.props.value).toBe('5');
        expect(input.focused).toBe(true);
        expect(input.selected).toBe(true);
        // A number field would bring spinners and mouse-wheel edits.
        expect(input.props.type).toBe('text');
        expect(input.props.inputmode).toBe('numeric');
        expect(String(input.props.maxlength)).toBe('4');
        expect(input.props['aria-label']).toBe(i18n.rates.progressLabel);
        expect(input.props.title).toBe(i18n.rates.progressHint);
        // The tail stays put: the ceiling is in front of the eyes while typing.
        expect(textOf(find(container, 'rate__progress-tail'))).toBe('/ 11 эп.');
        expect(findAll(container, 'rate__progress-btn')).toHaveLength(0);
    });

    it('describes the field with the tail (unit or limit)', async () => {
        const { container } = mountEditor(row({ progress: 5, total: 11 }));
        const input = await openEditor(container);
        const tail = find(container, 'rate__progress-tail');
        expect(typeof tail.props.id).toBe('string');
        expect(tail.props.id).not.toBe('');
        expect(input.props['aria-describedby']).toBe(tail.props.id);
    });

    it('Enter writes the absolute number typed, not a delta', async () => {
        const { container, written } = mountEditor(row({ progress: 5, total: 11 }));
        const input = await openEditor(container);
        typeInto(input, '11');
        await nextTick();
        keydownOn(input, 'Enter');
        expect(written).toEqual([11]);
        await nextTick();
        expect(findAll(container, 'rate__progress-input')).toHaveLength(0);
    });

    it('Enter on an unchanged value closes without spending a request', async () => {
        const { container, written } = mountEditor(row({ progress: 5, total: 11 }));
        const input = await openEditor(container);
        keydownOn(input, 'Enter');
        expect(written).toEqual([]);
        await nextTick();
        expect(findAll(container, 'rate__progress-input')).toHaveLength(0);
    });

    it('Enter on an emptied field just closes: empty is mid-typing, not an error', async () => {
        const { container, written } = mountEditor(row({ progress: 5, total: 11 }));
        const input = await openEditor(container);
        typeInto(input, '');
        await nextTick();
        expect(classesOf(input)).not.toContain('rate__progress-input--invalid');
        keydownOn(input, 'Enter');
        expect(written).toEqual([]);
        await nextTick();
        expect(findAll(container, 'rate__progress-input')).toHaveLength(0);
    });

    it('Esc cancels the draft and hands the caret back to the phrase', async () => {
        const { container, written } = mountEditor(row({ progress: 5, total: 11 }));
        const input = await openEditor(container);
        typeInto(input, '11');
        await nextTick();
        keydownOn(input, 'Escape');
        await nextTick();
        expect(written).toEqual([]);
        expect(findAll(container, 'rate__progress-input')).toHaveLength(0);
        const trigger = find(container, 'rate__progress-btn');
        expect(trigger.focused).toBe(true);
        // The old number is back on screen.
        expect(textOf(find(container, 'rate__progress-value'))).toBe('5');
    });

    it('blur cancels as well (a half-typed number must never be written)', async () => {
        const { container, written } = mountEditor(row({ progress: 5, total: 11 }));
        const input = await openEditor(container);
        typeInto(input, '1');
        await nextTick();
        fire(input, 'blur', {});
        await nextTick();
        expect(written).toEqual([]);
        expect(findAll(container, 'rate__progress-input')).toHaveLength(0);
        // Focus is not pulled back: the user is already somewhere else.
        expect(find(container, 'rate__progress-btn').focused).toBe(false);
    });

    it('reopening after a cancel starts from the row value again', async () => {
        const { container } = mountEditor(row({ progress: 5, total: 11 }));
        const first = await openEditor(container);
        typeInto(first, '11');
        await nextTick();
        keydownOn(first, 'Escape');
        await nextTick();
        const second = await openEditor(container);
        expect(second.props.value).toBe('5');
    });

    it('shows a value above the total in the row and refuses to write it', async () => {
        const { container, written } = mountEditor(row({ progress: 5, total: 11 }));
        const input = await openEditor(container);
        typeInto(input, '24');
        await nextTick();

        expect(classesOf(input)).toContain('rate__progress-input--invalid');
        expect(input.props['aria-invalid']).toBe('true');
        const tail = find(container, 'rate__progress-tail');
        expect(textOf(tail)).toBe('макс. 11');
        expect(classesOf(tail)).toContain('rate__progress-tail--invalid');

        keydownOn(input, 'Enter');
        await nextTick();
        expect(written).toEqual([]);
        // The field stays open with the caret in place — nothing to retype.
        expect(findAll(container, 'rate__progress-input')).toHaveLength(1);
    });

    it('accepts the total itself and 0', async () => {
        for (const [typed, expected] of [
            ['11', 11],
            ['0', 0],
        ] as const) {
            const { container, written } = mountEditor(row({ progress: 5, total: 11 }));
            const input = await openEditor(container);
            typeInto(input, typed);
            await nextTick();
            expect(classesOf(input)).not.toContain('rate__progress-input--invalid');
            keydownOn(input, 'Enter');
            expect(written).toEqual([expected]);
        }
    });

    it('has no upper bound when the total is unknown (0)', async () => {
        const { container, written } = mountEditor(row({ progress: 1146, total: 0 }));
        expect(textOf(find(container, 'rate__progress-tail'))).toBe('эп.');
        const input = await openEditor(container);
        typeInto(input, '1147');
        await nextTick();
        expect(classesOf(input)).not.toContain('rate__progress-input--invalid');
        keydownOn(input, 'Enter');
        expect(written).toEqual([1147]);
    });

    it('keeps everything but digits out of the field', async () => {
        const { container } = mountEditor(row({ progress: 5, total: 0 }));
        const input = await openEditor(container);

        const typed = typeInto(input, '1a2-,');
        await nextTick();
        // Filtered text is written back into the DOM as well: the bound value
        // did not change, so Vue alone would leave the junk on screen.
        expect(typed.value).toBe('12');
        expect(input.props.value).toBe('12');

        const pasted = typeInto(input, '12345');
        await nextTick();
        expect(pasted.value).toBe('1234');
        expect(input.props.value).toBe('1234');
    });

    it('counts chapters in a manga row', async () => {
        const { container, written } = mountEditor(
            row({ targetType: 'Manga', progress: 118, total: 200 }),
        );
        const trigger = find(container, 'rate__progress-btn');
        expect(trigger.props['aria-label']).toBe(i18n.rates.editProgressChapter);
        expect(textOf(find(container, 'rate__progress-tail'))).toBe('/ 200 гл.');

        const input = await openEditor(container);
        expect(input.props['aria-label']).toBe(i18n.rates.progressLabelChapter);
        typeInto(input, '250');
        await nextTick();
        expect(textOf(find(container, 'rate__progress-tail'))).toBe('макс. 200');
        keydownOn(input, 'Enter');
        expect(written).toEqual([]);

        typeInto(input, '200');
        await nextTick();
        keydownOn(input, 'Enter');
        expect(written).toEqual([200]);
    });

    // Unlike [+1], which only exists for «Смотрю»/«Пересматриваю»: where the
    // user stopped has to be recordable in «Отложено» and «Брошено» too.
    it.each(['planned', 'completed', 'on_hold', 'dropped'] as const)(
        'offers the field at status %s, where [+1] does not exist',
        async (status) => {
            const { container, written } = mountEditor(row({ status, progress: 5, total: 11 }));
            expect(findAll(container, 'rate__inc')).toHaveLength(0);
            const input = await openEditor(container);
            typeInto(input, '7');
            await nextTick();
            keydownOn(input, 'Enter');
            expect(written).toEqual([7]);
        },
    );

    it('stays shut while a write for the row is in flight', async () => {
        const { container } = mountEditor(row({ progress: 5, total: 11 }), true);
        const trigger = find(container, 'rate__progress-btn');
        expect(trigger.props.disabled).toBe(true);
        clickOn(trigger);
        await nextTick();
        expect(findAll(container, 'rate__progress-input')).toHaveLength(0);
    });
});
