import { test } from './harness/fixtures.js';
import type { AnchorSpec } from './harness/recorder.js';
import { forEachOrder, type LayoutContext, settle } from './harness/scenario.js';

/**
 * The Assets page must not move while the gallery loads: skeleton cards in
 * the gallery's own grid, then the asset cards in their place. See
 * ../README.md#layout-stability.
 */

const MAIN = 'main[data-slot="app-shell-main"]';
// The gallery grid (ASSET_GRID_CLASS in asset-gallery.tsx), for skeleton and asset cards alike.
const GRID = `${MAIN} [class*="minmax(8.5rem"]`;

const GALLERY_ANCHORS: AnchorSpec[] = [
    {
        key: 'title',
        display: 'title row',
        selector: '[data-slot="page-header"]',
        props: ['x', 'y', 'width', 'height'],
    },
    { key: 'grid', display: 'gallery grid', selector: GRID, props: ['x', 'y', 'width'] },
    {
        key: 'card',
        display: 'card',
        selector: `${GRID} > *`,
        props: ['x', 'y', 'width', 'height'],
        each: 'index',
        firstAndLast: true,
    },
];

async function openAssets(ctx: LayoutContext) {
    await ctx.page.goto('/assets');
    await ctx.page.locator(`${GRID} > *`).first().waitFor();
    await settle(ctx);
}

test.describe('Asset gallery layout at 1440', () => {
    test.use({
        viewport: { width: 1440, height: 900 },
        // A function: Playwright reads an array here as a [value, options] pair.
        anchors: async ({}, use) => use(GALLERY_ANCHORS),
    });
    test.describe.configure({ timeout: 300_000 });

    test('cold reload', async ({ layout }) => {
        await forEachOrder(layout, {
            name: 'cold reload (assets)',
            prepare: async ctx => {
                if (!new URL(ctx.page.url()).pathname.endsWith('/assets')) await openAssets(ctx);
            },
            trigger: ({ page }) => page.reload({ waitUntil: 'commit' }),
        });
    });
});
