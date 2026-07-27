import { onBeforeUnmount, onMounted } from 'vue';
import type { Ref } from 'vue';

// Shared placement for the popovers of this UI (StatusMenu, ScorePicker).
//
// Ф6-24: both live inside the scroll container of their tab
// (.search__results / .lists__results, overflow-y: auto), and an absolutely
// positioned box is clipped by that container — a menu flipped upwards lost its
// top items behind the header, and in a low popup window it was cut in half.
// They are therefore laid out as `position: fixed`, which escapes ancestor
// overflow, with viewport coordinates computed here from the anchor.
//
// The anchor is the popover's own parent element — the wrapper the popover is
// nested in (.card__control, .rate__score, .rate__progress-row), the same box
// that used to be its containing block. Its `position: relative` is now only a
// declaration of intent, but it costs nothing and keeps the anchor obvious.
//
// Two conditions this depends on:
//   - no ancestor may establish a containing block for fixed descendants
//     (transform / filter / contain / perspective / will-change / backdrop-filter);
//     adding one above a popover would silently bring the clipping back;
//   - the popover must sit below every fixed overlay in the stacking order —
//     today that is only the toast (z-index 20 against the popovers' 10).

// Breathing room the flip decision wants at the window bottom — the threshold
// the flip has always used, kept so the popup renders exactly as before.
const FLIP_MARGIN = 8;

export interface PopoverPlacement {
    // Horizontal alignment against the anchor: 'start' pins the left edges
    // (what `left: 0` did), 'end' the right ones (`right: 0`).
    align: 'start' | 'end';
    // Vertical distance between anchor and popover, px.
    gap: number;
}

export interface PopoverOptions extends PopoverPlacement {
    // The anchor scrolled out of view. A fixed popover keeps following it, so
    // without this it would hang over the header with no visible trigger — the
    // one thing the old absolute popover could not do (it was clipped instead).
    onAnchorHidden: () => void;
}

// The parts of a DOMRect this module reads (so the pure function below can be
// tested with plain numbers).
export interface AnchorBox {
    top: number;
    left: number;
    right: number;
    bottom: number;
}

export interface Size {
    width: number;
    height: number;
}

function clampIntoWindow(value: number, limit: number): number {
    // limit < 0 means the popover is larger than the window: the near edge
    // wins, so its first items stay reachable instead of hanging offscreen.
    return Math.max(0, Math.min(value, Math.max(0, limit)));
}

// Pure geometry in viewport coordinates.
//
// Below the anchor by default; flips above only when the popover does not fit
// below AND there is more room above. The old rule flipped on "does not fit
// below" alone, which in a low window threw a 6-item menu clean off the top of
// the screen.
//
// The final clamp is a last resort against the window edges and deliberately
// keeps no margin of its own: it must not nudge a popover that is already fully
// on screen, so every placement the popup renders today stays put to the pixel.
export function placePopover(
    anchor: AnchorBox,
    size: Size,
    viewport: Size,
    placement: PopoverPlacement,
): { top: number; left: number } {
    const below = anchor.bottom + placement.gap;
    const spaceBelow = viewport.height - FLIP_MARGIN - below;
    const spaceAbove = anchor.top - placement.gap - FLIP_MARGIN;
    const flip = size.height > spaceBelow && spaceAbove > spaceBelow;
    const top = flip ? anchor.top - placement.gap - size.height : below;
    const left = placement.align === 'end' ? anchor.right - size.width : anchor.left;
    return {
        top: clampIntoWindow(top, viewport.height - size.height),
        left: clampIntoWindow(left, viewport.width - size.width),
    };
}

// Vertical overlap test: these popovers hang off rows of a vertically scrolling
// list, and nothing in this UI clips them horizontally.
export function isAnchorVisible(
    anchor: Pick<AnchorBox, 'top' | 'bottom'>,
    clip: { top: number; bottom: number },
): boolean {
    return anchor.bottom > clip.top && anchor.top < clip.bottom;
}

function scrollParentOf(node: HTMLElement): HTMLElement | null {
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        const overflowY = getComputedStyle(parent).overflowY;
        if (overflowY === 'auto' || overflowY === 'scroll') {
            return parent;
        }
    }
    return null;
}

// Places `el` against its parent element and keeps it there while the page or
// any scroll container moves. No-op without a DOM (component tests run on a
// DOM-less renderer, src/components/fake-renderer.ts): the popover then keeps
// its static position, which is where it would have rendered in flow anyway.
export function usePopoverPosition(el: Ref<HTMLElement | null>, options: PopoverOptions): void {
    let attached = false;
    // The box the anchor is visible in: the tab's results container, or the
    // window on the search page, where the document scrolls instead.
    let clipper: HTMLElement | null = null;
    // The opening placement is unconditional — the user just clicked the anchor,
    // so it is visible by construction; only later moves can lose it.
    let placed = false;

    function place(): void {
        const node = el.value;
        const anchor = node?.parentElement;
        if (!node || !anchor) {
            return;
        }
        const anchorRect = anchor.getBoundingClientRect();
        const clipRect = clipper?.getBoundingClientRect();
        const clip = {
            top: Math.max(0, clipRect?.top ?? 0),
            bottom: Math.min(window.innerHeight, clipRect?.bottom ?? window.innerHeight),
        };
        if (placed && !isAnchorVisible(anchorRect, clip)) {
            options.onAnchorHidden();
            return;
        }
        const { top, left } = placePopover(
            anchorRect,
            node.getBoundingClientRect(),
            { width: window.innerWidth, height: window.innerHeight },
            options,
        );
        node.style.top = `${top}px`;
        node.style.left = `${left}px`;
        placed = true;
    }

    onMounted(() => {
        // Measured after insertion but before paint: no visible jump.
        if (typeof el.value?.getBoundingClientRect !== 'function') {
            return;
        }
        clipper = scrollParentOf(el.value);
        place();
        // Capture phase: scroll does not bubble, so this is the only way to hear
        // the results container move. The popover follows its anchor exactly as
        // the absolutely positioned one did.
        window.addEventListener('scroll', place, { capture: true, passive: true });
        window.addEventListener('resize', place);
        attached = true;
    });

    onBeforeUnmount(() => {
        if (!attached) {
            return;
        }
        window.removeEventListener('scroll', place, { capture: true });
        window.removeEventListener('resize', place);
    });
}
