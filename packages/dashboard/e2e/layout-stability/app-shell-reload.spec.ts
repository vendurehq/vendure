import type { AllowRule } from './harness/analyze.js';
import { test } from './harness/fixtures.js';
import type { AnchorSpec } from './harness/recorder.js';
import { forEachOrder, type LayoutContext, settle } from './harness/scenario.js';

/**
 * A reload draws the app shell from the first paint (the boot screen in
 * index.html), and the app replaces it without a shift: the sidebar, the top
 * bar and the page title row stay where the boot screen drew them. Each anchor
 * matches the boot screen's element first and the app's once the boot screen
 * is gone. See ../README.md#layout-stability.
 */

const SHELL_ANCHORS: AnchorSpec[] = [
    {
        key: 'sidebar',
        display: 'sidebar',
        selector: '.boot-sidebar, [data-slot="sidebar-container"]',
        props: ['x', 'y', 'width'],
    },
    {
        key: 'topbar',
        display: 'top bar',
        selector: '.boot-header, [data-slot="app-shell-header"]',
        props: ['x', 'y', 'width', 'height'],
    },
    {
        key: 'title',
        display: 'title row',
        selector: '.boot-page-header, main[data-slot="app-shell-main"] [data-slot="page-header"]',
        props: ['x', 'y', 'width', 'height'],
    },
];

/**
 * The CommandDialog of @vendure-io/ui renders its sr-only DialogHeader outside
 * DialogContent, in the page flow. Its `sticky` class beats `sr-only`, so it
 * takes 1px of the shell row and the app is 1px narrower than the boot screen.
 * Remove this rule once the design system fixes it.
 */
const COMMAND_DIALOG_HEADER: AllowRule[] = [{ anchor: /^(topbar|title)$/, props: ['width'] }];

const PAGES = [
    { name: 'Insights', path: '/' },
    { name: 'Product list', path: '/products' },
    { name: 'Global settings', path: '/global-settings' },
];

test.describe('App shell on reload at 1440', () => {
    test.use({
        viewport: { width: 1440, height: 900 },
        // A function: Playwright reads an array here as a [value, options] pair.
        anchors: async ({}, use) => use(SHELL_ANCHORS),
    });
    test.describe.configure({ timeout: 300_000 });

    for (const { name, path } of PAGES) {
        test(`${name}, cold reload`, async ({ layout }) => {
            await forEachOrder(layout, {
                name: `cold reload (${name})`,
                prepare: async (ctx: LayoutContext) => {
                    if (new URL(ctx.page.url()).pathname !== path) {
                        await ctx.page.goto(path);
                        await ctx.page.getByTestId('page-heading').waitFor();
                        await settle(ctx);
                    }
                },
                trigger: ({ page }) => page.reload({ waitUntil: 'commit' }),
                allow: COMMAND_DIALOG_HEADER,
            });
        });
    }
});
