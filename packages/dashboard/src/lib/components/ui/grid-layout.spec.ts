import { describe, expect, it } from 'vitest';

import {
    compactLayouts,
    findNextAvailablePosition,
    GridLayout,
    insertWithReflow,
    layoutsOverlap,
    reflowAroundAnchor,
    tidyLayouts,
} from './grid-layout.js';

const item = (i: string, x: number, y: number, w: number, h: number): GridLayout => ({ i, x, y, w, h });

function expectNoOverlaps(layouts: GridLayout[]) {
    for (let a = 0; a < layouts.length; a++) {
        for (let b = a + 1; b < layouts.length; b++) {
            expect(layoutsOverlap(layouts[a], layouts[b]), `${layouts[a].i} overlaps ${layouts[b].i}`).toBe(
                false,
            );
        }
    }
}

const byId = (layouts: GridLayout[], id: string): GridLayout => {
    const found = layouts.find(l => l.i === id);
    if (!found) {
        throw new Error(`No layout with id "${id}"`);
    }
    return found;
};

describe('layoutsOverlap', () => {
    it('detects overlapping items', () => {
        expect(layoutsOverlap(item('a', 0, 0, 4, 2), item('b', 2, 1, 4, 2))).toBe(true);
    });

    it('treats edge-adjacent items as non-overlapping', () => {
        expect(layoutsOverlap(item('a', 0, 0, 4, 2), item('b', 4, 0, 4, 2))).toBe(false);
        expect(layoutsOverlap(item('a', 0, 0, 4, 2), item('b', 0, 2, 4, 2))).toBe(false);
    });
});

describe('compactLayouts', () => {
    it('floats a lower widget up to fill the gap left above it', () => {
        const result = compactLayouts([item('a', 0, 0, 6, 2), item('b', 0, 5, 6, 2)]);
        expect(byId(result, 'a').y).toBe(0);
        expect(byId(result, 'b').y).toBe(2);
    });

    it('closes the gap left when a middle widget is removed', () => {
        // widgets originally stacked at y=0,2,4; the middle one (y=2) has been removed.
        const result = compactLayouts([item('a', 0, 0, 12, 2), item('c', 0, 4, 12, 2)]);
        expect(byId(result, 'a').y).toBe(0);
        expect(byId(result, 'c').y).toBe(2);
    });

    it('preserves horizontal position and compacts side-by-side widgets independently', () => {
        const result = compactLayouts([item('a', 0, 3, 6, 2), item('b', 6, 0, 6, 2)]);
        expect(byId(result, 'a')).toMatchObject({ x: 0, y: 0 });
        expect(byId(result, 'b')).toMatchObject({ x: 6, y: 0 });
    });

    it('preserves the input order regardless of position', () => {
        const result = compactLayouts([item('a', 0, 5, 6, 2), item('b', 0, 0, 6, 2)]);
        expect(result.map(l => l.i)).toEqual(['a', 'b']);
    });

    it('never produces overlaps', () => {
        const result = compactLayouts([item('a', 0, 4, 6, 2), item('b', 0, 0, 6, 2), item('c', 6, 0, 6, 3)]);
        expectNoOverlaps(result);
    });
});

describe('insertWithReflow', () => {
    it('keeps the inserted item at its saved position and pushes an overlapping widget down', () => {
        const result = insertWithReflow([item('a', 0, 0, 12, 2)], item('b', 0, 0, 12, 2));
        expect(byId(result, 'b')).toMatchObject({ x: 0, y: 0 });
        expect(byId(result, 'a').y).toBeGreaterThanOrEqual(2);
        expectNoOverlaps(result);
    });

    it('leaves other widgets untouched when the saved space is free', () => {
        const result = insertWithReflow([item('a', 0, 0, 6, 2)], item('b', 6, 0, 6, 2));
        expect(byId(result, 'a')).toMatchObject({ x: 0, y: 0 });
        expect(byId(result, 'b')).toMatchObject({ x: 6, y: 0 });
        expectNoOverlaps(result);
    });

    it('appends the inserted item so it is always present in the output', () => {
        const result = insertWithReflow([item('a', 0, 0, 6, 2)], item('b', 0, 0, 6, 2));
        expect(result).toHaveLength(2);
        expect(result.map(l => l.i)).toContain('b');
    });

    it('reflows multiple overlapping widgets without overlaps', () => {
        const result = insertWithReflow(
            [item('a', 0, 0, 6, 2), item('b', 6, 0, 6, 2)],
            item('c', 0, 0, 12, 2),
        );
        expect(byId(result, 'c')).toMatchObject({ x: 0, y: 0 });
        expectNoOverlaps(result);
    });
});

describe('reflowAroundAnchor', () => {
    it('keeps the anchor fixed and moves overlapping items out of the way', () => {
        const result = reflowAroundAnchor(
            [item('a', 0, 0, 12, 2), item('b', 0, 2, 12, 2)],
            item('b', 0, 0, 12, 2),
        );
        expect(byId(result, 'b')).toMatchObject({ x: 0, y: 0 });
        expectNoOverlaps(result);
    });
});

describe('tidyLayouts', () => {
    const gridHeight = (layouts: GridLayout[]) => Math.max(0, ...layouts.map(l => l.y + l.h));

    it('pulls scattered widgets up into a gap-free arrangement', () => {
        const result = tidyLayouts([item('a', 0, 3, 6, 2), item('b', 6, 7, 6, 2)]);
        expect(byId(result, 'a')).toMatchObject({ x: 0, y: 0 });
        expect(byId(result, 'b')).toMatchObject({ x: 6, y: 0 });
        expectNoOverlaps(result);
    });

    it('packs a full row before starting the next one', () => {
        const result = tidyLayouts([item('a', 0, 4, 6, 2), item('b', 0, 8, 6, 2), item('c', 0, 0, 6, 2)]);
        // c (topmost) stays at 0,0; a and b pack to its right and below.
        expect(byId(result, 'c')).toMatchObject({ x: 0, y: 0 });
        expect(byId(result, 'a')).toMatchObject({ x: 6, y: 0 });
        expect(byId(result, 'b')).toMatchObject({ x: 0, y: 2 });
        expectNoOverlaps(result);
    });

    it('preserves the input order', () => {
        const result = tidyLayouts([item('a', 0, 5, 6, 2), item('b', 0, 0, 6, 2)]);
        expect(result.map(l => l.i)).toEqual(['a', 'b']);
    });

    const bounded = (
        i: string,
        x: number,
        y: number,
        w: number,
        h: number,
        bounds: Pick<GridLayout, 'minW' | 'minH' | 'maxW' | 'maxH'>,
    ): GridLayout => ({ i, x, y, w, h, ...bounds });

    it('grows an unconstrained widget to fill the empty space in its row', () => {
        const result = tidyLayouts([item('a', 0, 0, 6, 2)]);
        // Sole widget: fills the full 12-col width; height stays as there is no gap below it.
        expect(byId(result, 'a')).toMatchObject({ x: 0, y: 0, w: 12, h: 2 });
    });

    it('grows a short widget down to fill the hole beside a taller neighbour', () => {
        const result = tidyLayouts([item('a', 0, 0, 6, 3), item('b', 6, 0, 6, 1)]);
        expect(byId(result, 'b')).toMatchObject({ x: 6, y: 0, w: 6, h: 3 });
        expectNoOverlaps(result);
    });

    it('clamps growth to each widget max bounds', () => {
        const result = tidyLayouts([
            bounded('a', 0, 0, 6, 4, {}),
            bounded('b', 6, 0, 4, 2, { maxW: 5, maxH: 3 }),
        ]);
        // b sits in a 6-wide, 4-tall gap but may not exceed maxW=5 / maxH=3.
        expect(byId(result, 'b')).toMatchObject({ w: 5, h: 3 });
        expectNoOverlaps(result);
    });

    it('never shrinks a widget below its input size', () => {
        const result = tidyLayouts([item('a', 0, 0, 12, 2), item('b', 0, 2, 12, 2)]);
        expect(byId(result, 'a')).toMatchObject({ w: 12, h: 2 });
        expect(byId(result, 'b')).toMatchObject({ w: 12, h: 2 });
    });

    it('is idempotent once widgets have been grown to fill', () => {
        const once = tidyLayouts([item('a', 0, 3, 6, 2), item('b', 6, 7, 4, 3), item('c', 1, 1, 3, 2)]);
        const twice = tidyLayouts(once);
        expect(twice).toEqual(once);
    });

    it('leaves no holes within the packed area when growth is unconstrained', () => {
        const result = tidyLayouts([item('a', 0, 0, 5, 2), item('b', 5, 0, 7, 3), item('c', 0, 2, 4, 1)]);
        const height = Math.max(0, ...result.map(l => l.y + l.h));
        const filled = result.reduce((sum, l) => sum + l.w * l.h, 0);
        expect(filled).toBe(12 * height);
        expectNoOverlaps(result);
    });

    it('is idempotent — tidying an already-tidy layout is a no-op', () => {
        const once = tidyLayouts([item('a', 0, 3, 6, 2), item('b', 6, 7, 4, 2), item('c', 2, 1, 5, 3)]);
        const twice = tidyLayouts(once);
        expect(twice).toEqual(once);
    });

    it('reduces or maintains total grid height', () => {
        const input = [item('a', 0, 0, 6, 2), item('b', 0, 5, 6, 2), item('c', 6, 9, 6, 2)];
        const result = tidyLayouts(input);
        expect(gridHeight(result)).toBeLessThanOrEqual(gridHeight(input));
        expectNoOverlaps(result);
    });

    it('never produces overlaps for tightly-packed mixed sizes', () => {
        const result = tidyLayouts([
            item('a', 0, 0, 5, 2),
            item('b', 5, 0, 7, 3),
            item('c', 0, 2, 5, 4),
            item('d', 8, 3, 4, 2),
        ]);
        expectNoOverlaps(result);
    });
});

describe('findNextAvailablePosition', () => {
    it('finds a free slot to the side on the same row when available', () => {
        const pos = findNextAvailablePosition(
            item('a', 0, 0, 6, 2),
            [item('b', 0, 0, 6, 2)],
            item('b', 0, 0, 6, 2),
        );
        expect(pos).toMatchObject({ x: 6, y: 0 });
    });
});
