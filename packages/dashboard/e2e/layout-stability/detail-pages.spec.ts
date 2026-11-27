import type { AllowRule } from './harness/analyze.js';
import { TABLE, waitForList } from './harness/anchors.js';
import { test } from './harness/fixtures.js';
import type { AnchorSpec } from './harness/recorder.js';
import { forEachOrder, type LayoutContext, settle } from './harness/scenario.js';

/**
 * A detail page loads into a skeleton of its own layout: the title row and
 * the columns of its cards are where the page puts them, from the first frame.
 * Card heights are left out here: a table inside a card draws its skeleton
 * rows before it knows its row count, which is the DataTable's to keep still.
 * See ../README.md#layout-stability.
 */

const MAIN = 'main[data-slot="app-shell-main"]';

const DETAIL_ANCHORS: AnchorSpec[] = [
    {
        key: 'title',
        display: 'title row',
        selector: '[data-slot="page-header"]',
        props: ['x', 'y', 'width', 'height'],
    },
    {
        key: 'card',
        display: 'card',
        selector: `${MAIN} [data-slot="card"]`,
        props: ['x', 'width'],
        each: 'index',
    },
];

/** Layout shifts inside a DataTable when its rows arrive: its column widths and footer. The DataTable work owns them. */
const tableRowsArrive = (operation: string): AllowRule => ({
    node: /(data-slot="(table-head|card-footer)"\]|th(:nth-child\(\d+\))?)$/,
    label: new RegExp(`^released: ${operation}$`),
});

/**
 * The detail pages to check, each opened from the first row of its list, with
 * the moves that belong to other components. The Collection page has its own
 * spec (collection-detail.spec.ts).
 */
const PAGES: Array<{ name: string; list: string; allow?: AllowRule[] }> = [
    {
        name: 'Product',
        list: '/products',
        // The asset of a relation custom field, when its asset query returns.
        allow: [{ node: /> img(:nth-child\(\d+\))?$/, label: /^released: GetAssetsForRelationSelector$/ }],
    },
    { name: 'Facet', list: '/facets', allow: [tableRowsArrive('FacetValueList')] },
    { name: 'Customer', list: '/customers' },
    { name: 'Administrator', list: '/administrators' },
];

async function openFirstDetail(ctx: LayoutContext, list: string) {
    await ctx.page.goto(list);
    await waitForList(ctx.page);
    await ctx.page.locator(`${TABLE} [data-slot="data-table-row-link"]`).first().click();
    await ctx.page.waitForURL(url => url.pathname.split('/').filter(Boolean).length > 1);
    await ctx.page.getByTestId('page-heading').waitFor();
    await settle(ctx);
}

test.describe('Detail page layout at 1440', () => {
    test.use({
        viewport: { width: 1440, height: 900 },
        // A function: Playwright reads an array here as a [value, options] pair.
        anchors: async ({}, use) => use(DETAIL_ANCHORS),
    });
    test.describe.configure({ timeout: 300_000 });

    for (const { name, list, allow } of PAGES) {
        test(`${name}, cold reload`, async ({ layout }) => {
            await forEachOrder(layout, {
                name: `cold reload (${name})`,
                prepare: async ctx => {
                    if (!new URL(ctx.page.url()).pathname.startsWith(`${list}/`))
                        await openFirstDetail(ctx, list);
                },
                trigger: ({ page }) => page.reload({ waitUntil: 'commit' }),
                allow,
            });
        });
    }
});
