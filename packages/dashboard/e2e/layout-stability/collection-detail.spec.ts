import type { AllowRule } from './harness/analyze.js';
import { TABLE, waitForList } from './harness/anchors.js';
import { test } from './harness/fixtures.js';
import type { AnchorSpec } from './harness/recorder.js';
import { forEachOrder, type LayoutContext, settle } from './harness/scenario.js';

/**
 * The Collection page must not move while its filters load: each saved
 * filter draws a skeleton row of its own height, so the cards below it, such
 * as Contents, keep their place. See ../README.md#layout-stability.
 */

const MAIN = 'main[data-slot="app-shell-main"]';
const BLOCK_CARD = ':is([data-slot="card"], [data-slot="data-table"])';

const COLLECTION_ANCHORS: AnchorSpec[] = [
    {
        key: 'card',
        display: 'card',
        // The outermost cards: a loaded DataTable card has the slot `data-table`, its
        // skeleton is a `card` around a plain `data-table`. The Platform promotion
        // card is left out: the skeleton leaves it out, and it appears at the
        // bottom of its column without moving the cards above.
        selector: `${MAIN} ${BLOCK_CARD}:not(${BLOCK_CARD} *):not(:has([data-testid="platform-promotion-page-card"]))`,
        props: ['x', 'y', 'width', 'height'],
        each: 'index',
    },
    {
        // The header labels of the Contents table: a column indent that arrives with
        // the rows moves them.
        key: 'header',
        display: 'table header label',
        selector: `${MAIN} ${TABLE} thead th > :first-child`,
        props: ['x', 'y'],
        each: 'text',
    },
];

/**
 * The route skeleton becomes the page when the Collection itself loads. That
 * step belongs to the detail page skeleton, not to the filters, so it may move
 * the cards. Every later step may not.
 */
const PAGE_ARRIVES: AllowRule[] = [
    { anchor: /^card:/, props: ['x', 'y', 'width', 'height'], label: /^released: CollectionDetail$/ },
    { node: /./, label: /^released: CollectionDetail$/ },
];

/** Opens the first Collection of the list. The e2e Collections have facet value filters. */
async function openFirstCollection(ctx: LayoutContext) {
    await ctx.page.goto('/collections');
    await waitForList(ctx.page);
    await ctx.page.locator(`${TABLE} [data-slot="data-table-row-link"]`).first().click();
    await ctx.page.waitForURL(/\/collections\/[^/]+$/);
    await ctx.page.getByTestId('page-heading').waitFor();
    await settle(ctx);
    // Load the page once more: the filter name widths are stored while the page
    // settles, and the measured reload must find them in storage.
    await ctx.page.reload();
    await ctx.page.getByTestId('page-heading').waitFor();
    await settle(ctx);
}

test.describe('Collection detail layout at 1440', () => {
    test.use({
        viewport: { width: 1440, height: 900 },
        // A function: Playwright reads an array here as a [value, options] pair.
        anchors: async ({}, use) => use(COLLECTION_ANCHORS),
    });
    test.describe.configure({ timeout: 300_000 });

    test('cold reload', async ({ layout }) => {
        await forEachOrder(layout, {
            name: 'cold reload (collection)',
            prepare: async ctx => {
                if (!/\/collections\/[^/]+$/.test(new URL(ctx.page.url()).pathname))
                    await openFirstCollection(ctx);
            },
            trigger: ({ page }) => page.reload({ waitUntil: 'commit' }),
            allow: PAGE_ARRIVES,
        });
    });
});
