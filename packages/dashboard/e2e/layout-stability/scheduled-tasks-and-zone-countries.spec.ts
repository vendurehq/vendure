import type { AllowRule } from './harness/analyze.js';
import { LIST_PAGE_ANCHORS, TABLE, waitForList } from './harness/anchors.js';
import { test } from './harness/fixtures.js';
import { forEachOrder, type LayoutContext, settle } from './harness/scenario.js';

/**
 * The Scheduled Tasks list and the countries table of a Zone must not move
 * while they load: skeleton rows first, then the rows in the same place. See
 * ../README.md#layout-stability.
 */

/**
 * Inter loads with `font-display: swap`. On a cold reload it can arrive after the
 * first paint, and the breadcrumb text then redraws a few pixels wider. That is
 * the app's font loading, not the table. A shift excused here has only
 * breadcrumb nodes as its sources.
 */
const BREADCRUMB_FONT_SWAP: AllowRule[] = [{ node: /nav\[data-slot="breadcrumb"\]/ }];

async function openScheduledTasks(ctx: LayoutContext) {
    await ctx.page.goto('/scheduled-tasks');
    await waitForList(ctx.page);
    await settle(ctx);
}

/** Opens the first Zone of the Zones list, which has countries in the e2e data. */
async function openFirstZone(ctx: LayoutContext) {
    await ctx.page.goto('/zones');
    await waitForList(ctx.page);
    await ctx.page.locator(`${TABLE} [data-slot="data-table-row-link"]`).first().click();
    await ctx.page.waitForURL(/\/zones\/[^/]+$/);
    await waitForList(ctx.page);
    await settle(ctx);
    // Load the page once more before the measured reload. Right after the click
    // that opened it, the table has only just stored its row count, and a reload
    // a few frames later can miss it (1 in about 4 first runs) and draw 10
    // skeleton rows. A user does not reload within frames of opening a page.
    await ctx.page.reload();
    await waitForList(ctx.page);
    await settle(ctx);
}

test.describe('Scheduled Tasks and Zone countries layout at 1440', () => {
    test.use({ viewport: { width: 1440, height: 900 } });
    test.describe.configure({ timeout: 300_000 });

    test('Scheduled Tasks, cold reload', async ({ layout }) => {
        await forEachOrder(layout, {
            name: 'cold reload (scheduled tasks)',
            prepare: async ctx => {
                if (!new URL(ctx.page.url()).pathname.endsWith('/scheduled-tasks'))
                    await openScheduledTasks(ctx);
            },
            trigger: ({ page }) => page.reload({ waitUntil: 'commit' }),
        });
    });

    test.describe('Zone countries', () => {
        // The countries table only: the frame of the detail page around it
        // (title row, content height) is the detail page skeleton's to keep still.
        // A function: Playwright reads an array here as a [value, options] pair.
        test.use({
            anchors: async ({}, use) =>
                use(LIST_PAGE_ANCHORS.filter(a => a.key !== 'title' && a.key !== 'content')),
        });

        test('Zone countries, cold reload', async ({ layout }) => {
            await forEachOrder(layout, {
                name: 'cold reload (zone countries)',
                prepare: async ctx => {
                    if (!/\/zones\/[^/]+$/.test(new URL(ctx.page.url()).pathname)) await openFirstZone(ctx);
                },
                trigger: ({ page }) => page.reload({ waitUntil: 'commit' }),
                allow: BREADCRUMB_FONT_SWAP,
            });
        });
    });
});
