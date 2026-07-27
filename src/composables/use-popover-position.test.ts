import { describe, expect, it } from 'vitest';
import { isAnchorVisible, placePopover } from './use-popover-position';
import type { AnchorBox, PopoverPlacement } from './use-popover-position';

// Ф6-24 placement geometry. Numbers mirror the real popup: a 380x580 window,
// a 200x242 status menu (6 statuses + «Удалить из списка») and the 8px margin
// the placement keeps to the window edges.

const START: PopoverPlacement = { align: 'start', gap: 4 };
const END: PopoverPlacement = { align: 'end', gap: 4 };
const MENU = { width: 200, height: 242 };
const POPUP = { width: 380, height: 580 };
// The owner's second machine: Chrome caps the popup at the space under the
// toolbar, so the same UI runs in a much lower window.
const LOW_POPUP = { width: 380, height: 420 };

// Trigger wrapper of a card, `top` px down the window.
function anchorAt(top: number, { left = 72, width = 130, height = 27 } = {}): AnchorBox {
    return { top, left, right: left + width, bottom: top + height };
}

describe('placePopover', () => {
    it('opens below the anchor, left edges aligned', () => {
        expect(placePopover(anchorAt(200), MENU, POPUP, START)).toEqual({ top: 231, left: 72 });
    });

    it('aligns right edges for align: end', () => {
        const anchor = anchorAt(200, { left: 300, width: 40 });
        expect(placePopover(anchor, MENU, POPUP, END)).toEqual({ top: 231, left: 140 });
    });

    it('flips above the anchor when there is no room below', () => {
        // bottom = 507; below would end at 753, far past the 580px window.
        expect(placePopover(anchorAt(480), MENU, POPUP, START)).toEqual({ top: 234, left: 72 });
    });

    it('stays below when the popover fits, however close to the flip point', () => {
        // bottom = 326, below spans 330..572 — exactly the usable height, so
        // still no flip.
        expect(placePopover(anchorAt(299), MENU, POPUP, START).top).toBe(330);
    });

    // The bug: the old rule flipped on "does not fit below" alone. In a low
    // window that threw the menu of a top card above the window edge (and,
    // being absolutely positioned inside the results scroller, it was cut off
    // under the header). Room above is now compared with room below — here
    // below wins, and the clamp pulls the menu up just enough to fit.
    it('does not flip when there is even less room above (low window)', () => {
        const anchor = anchorAt(150); // bottom 177: 231 below, 138 above
        expect(placePopover(anchor, MENU, LOW_POPUP, START).top).toBe(178);
    });

    it('flips in a low window only when above is the roomier side', () => {
        const anchor = anchorAt(280); // bottom 307: 105 below, 268 above
        expect(placePopover(anchor, MENU, LOW_POPUP, START).top).toBe(34);
    });

    it('keeps the popover inside the window when it fits neither side', () => {
        // A menu taller than the window: the top edge wins, so the first items
        // stay reachable instead of hanging above the viewport.
        expect(placePopover(anchorAt(180), MENU, { width: 380, height: 240 }, START).top).toBe(0);
    });

    it('clamps a popover that would overhang the bottom edge', () => {
        // Anchor low enough that "below" overflows the window, but with even
        // less room above — no flip, so the clamp is what keeps it on screen.
        const placed = placePopover(anchorAt(230), MENU, { width: 380, height: 500 }, START);
        expect(placed.top).toBe(258);
    });

    it('leaves a placement that is already on screen untouched', () => {
        // Ten pixels higher the menu ends inside the window (493 of 500) —
        // the clamp keeps no margin of its own, so nothing moves even though
        // the flip margin alone would consider it tight.
        const placed = placePopover(anchorAt(220), MENU, { width: 380, height: 500 }, START);
        expect(placed.top).toBe(251);
    });

    it('clamps horizontally instead of overflowing the right edge', () => {
        const anchor = anchorAt(200, { left: 300, width: 60 });
        expect(placePopover(anchor, MENU, POPUP, START).left).toBe(180);
    });
});

// A fixed popover follows its anchor while the list scrolls; once the anchor
// itself is gone, the popover has to go with it (an absolute one used to be
// clipped away by the same scroller).
describe('isAnchorVisible', () => {
    const clip = { top: 175, bottom: 580 }; // the results container of the popup

    it('is visible while any part of the anchor is inside the clip box', () => {
        expect(isAnchorVisible({ top: 300, bottom: 330 }, clip)).toBe(true);
        expect(isAnchorVisible({ top: 160, bottom: 176 }, clip)).toBe(true);
        expect(isAnchorVisible({ top: 579, bottom: 610 }, clip)).toBe(true);
    });

    it('is hidden once the anchor has left the clip box entirely', () => {
        expect(isAnchorVisible({ top: 140, bottom: 175 }, clip)).toBe(false);
        expect(isAnchorVisible({ top: 580, bottom: 612 }, clip)).toBe(false);
    });
});
