import { test } from './harness/fixtures.js';
import type { AnchorSpec } from './harness/recorder.js';
import { forEachOrder, type LayoutContext, settle } from './harness/scenario.js';

/**
 * The Insights page must not move while its widgets load: each widget draws a
 * skeleton in the shape of its content, and the content replaces it in the
 * same place. See ../README.md#layout-stability.
 */

const MAIN = 'main[data-slot="app-shell-main"]';

const INSIGHTS_ANCHORS: AnchorSpec[] = [
    {
        key: 'title',
        display: 'title row',
        selector: '[data-slot="page-header"]',
        props: ['x', 'y', 'width', 'height'],
    },
    {
        key: 'widget',
        display: 'widget',
        selector: `${MAIN} [data-slot="card"]`,
        props: ['x', 'y', 'width', 'height'],
        each: 'index',
    },
    {
        key: 'widget-body',
        display: 'widget body',
        selector: `${MAIN} [data-slot="card-content"]`,
        props: ['x', 'y', 'width', 'height'],
        each: 'index',
    },
    // No content height: the page draws its widget grid only once the saved
    // layout has loaded, which is the page's to fix, not the widgets'.
];

async function openInsights(ctx: LayoutContext) {
    // The setup checklist appears above the widgets once its own query has loaded, and it cannot
    // be dismissed. It is measured on its own; here the check reports no findings, so it stays
    // hidden.
    await ctx.page.route('**/admin-api**', async route => {
        if ((route.request().postData() ?? '').includes('StoreReadinessForSetupChecklist')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ data: { storeReadiness: { ready: true, findings: [] } } }),
            });
        } else {
            await route.fallback();
        }
    });
    await ctx.page.goto('/');
    await ctx.page.locator(`${MAIN} [data-slot="card"]`).first().waitFor();
    await settle(ctx);
}

test.describe('Insights layout at 1440', () => {
    test.use({
        viewport: { width: 1440, height: 900 },
        // A function: Playwright reads an array here as a [value, options] pair.
        anchors: async ({}, use) => use(INSIGHTS_ANCHORS),
    });
    test.describe.configure({ timeout: 300_000 });

    test('cold reload', async ({ layout }) => {
        await forEachOrder(layout, {
            name: 'cold reload (insights)',
            prepare: async ctx => {
                if (new URL(ctx.page.url()).pathname.replace(/\/$/, '') !== '') await openInsights(ctx);
            },
            trigger: ({ page }) => page.reload({ waitUntil: 'commit' }),
        });
    });
});
