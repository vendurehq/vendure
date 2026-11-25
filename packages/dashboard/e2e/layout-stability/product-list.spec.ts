import type { Page } from '@playwright/test';

import type { AllowRule } from './harness/analyze.js';
import { EVERY_ROW, LIST_PAGE_ANCHORS, waitForList } from './harness/anchors.js';
import { test, VIEWPORTS } from './harness/fixtures.js';
import { forEachOrder, type LayoutContext, once, settle } from './harness/scenario.js';
import { fillPage, LIST_VARIANTS, type ListVariant, listVariant } from './harness/variants.js';

/**
 * The Product list must not move while it loads, between its loading, empty
 * and filled states, or in any interaction. Every scenario runs at desktop and
 * mobile width; scenarios that hold several operations run once per release
 * order. See ../README.md#layout-stability.
 */

const LIST = 'ProductList';
const TABLE = '[data-slot="data-table"]';

async function openList(ctx: LayoutContext) {
    await ctx.page.goto('/products');
    await waitForList(ctx.page);
    await settle(ctx);
}

/** The sidebar link to the Product list, with the sidebar (mobile) and its Catalog section open. */
async function productsNavLink(page: Page) {
    const link = page.locator('[data-slot="sidebar"] a[href$="/products"]').first();
    const catalog = page.locator('[data-slot="sidebar"]').getByRole('button', { name: 'Catalog' }).first();
    if (!(await catalog.isVisible())) {
        await page.locator('[data-sidebar="trigger"]').first().click();
        await catalog.waitFor();
    }
    if (!(await link.isVisible())) {
        await catalog.click();
        await link.waitFor();
    }
    return link;
}

/** Alternation of row indexes from `index` up to 99. */
const rowsFrom = (index: number) => Array.from({ length: 100 - index }, (_, i) => i + index).join('|');

const pagination = (page: Page) => page.locator(`${TABLE} [data-slot="table-pagination"]`);

/**
 * The number of rows changes (a page size, a search with fewer or no results):
 * the body may grow or shrink below its top edge, and the footer follows it.
 * Nothing above the first row moves, and the columns keep their widths.
 */
const ROWS_BELOW_MAY_MOVE: AllowRule[] = [
    { anchor: /^row:first$/, props: ['height'] },
    { anchor: /^(row:last|body|footer|content)$/, props: ['y', 'height'] },
    // Layout-shift entries of the footer and the body's rows (the source path ends in one).
    {
        anchor: /^$/,
        node: /(^|> )(\w+\[data-slot="(card-footer|table-body|table-row|table-cell)"\]|t[rd](:nth-child\(\d+\))?)$/,
    },
];

for (const viewport of VIEWPORTS) {
    test.describe(`Product list layout at ${viewport.width}`, () => {
        test.use({ viewport: { width: viewport.width, height: viewport.height } });
        test.describe.configure({ timeout: 300_000 });

        for (const variant of Object.keys(LIST_VARIANTS) as ListVariant[]) {
            test(`cold reload, ${LIST_VARIANTS[variant]}`, async ({ layout }) => {
                layout.network.rewrite(LIST, listVariant(variant));
                await forEachOrder(layout, {
                    name: `cold reload (${variant})`,
                    // The previous visit, as a signed-in user reloading the page has had.
                    prepare: async ctx => {
                        if (!new URL(ctx.page.url()).pathname.endsWith('/products')) await openList(ctx);
                    },
                    trigger: async ({ page }) => {
                        await page.reload({ waitUntil: 'commit' });
                    },
                });
            });
        }

        test('navigation from another page', async ({ layout }) => {
            await forEachOrder(layout, {
                name: 'navigation from Customers',
                prepare: async ctx => {
                    await openList(ctx);
                    await ctx.page.goto('/customers');
                    await waitForList(ctx.page);
                    // Opening the menu is not part of the navigation under test.
                    await productsNavLink(ctx.page);
                    await settle(ctx);
                },
                trigger: async ({ page }) => {
                    await page.locator('[data-slot="sidebar"] a[href$="/products"]').first().click();
                },
            });
        });

        test('back navigation from a product', async ({ layout }) => {
            await forEachOrder(layout, {
                name: 'back navigation',
                prepare: async ctx => {
                    await openList(ctx);
                    await ctx.page.locator(`${TABLE} [data-slot="data-table-row-link"]`).first().click();
                    await ctx.page.waitForURL(/\/products\/[^/]+$/);
                    await ctx.page.getByTestId('page-heading').waitFor();
                    await settle(ctx);
                },
                trigger: async ({ page }) => {
                    await page.goBack({ waitUntil: 'commit' });
                },
            });
        });

        test.describe('paging', () => {
            test.beforeEach(({ layout }) => layout.network.rewrite(LIST, listVariant('fullPage')));

            test('next page', async ({ layout }) => {
                await once(layout, {
                    name: 'next page',
                    prepare: openList,
                    trigger: ({ page }) =>
                        pagination(page).getByRole('button', { name: 'Go to next page' }).click(),
                });
            });

            test('previous page', async ({ layout }) => {
                await once(layout, {
                    name: 'previous page',
                    prepare: async ctx => {
                        await openList(ctx);
                        await pagination(ctx.page).getByRole('button', { name: 'Go to next page' }).click();
                        await ctx.page.waitForURL(/page=2/);
                        await settle(ctx);
                    },
                    trigger: ({ page }) =>
                        pagination(page).getByRole('button', { name: 'Go to previous page' }).click(),
                });
            });

            test('page size change', async ({ layout }) => {
                await once(layout, {
                    name: 'page size 20',
                    prepare: openList,
                    trigger: async ({ page }) => {
                        await pagination(page).locator('[data-slot="select-trigger"]').click();
                        await page.getByRole('option', { name: '20' }).click();
                    },
                    allow: ROWS_BELOW_MAY_MOVE,
                });
            });
        });

        test('sorting a column', async ({ layout }) => {
            layout.network.rewrite(LIST, listVariant('fullPage'));
            await once(layout, {
                name: 'sort by name',
                prepare: openList,
                trigger: ({ page }) =>
                    page
                        .locator(`${TABLE} thead th`)
                        .filter({ hasText: 'Name' })
                        .getByRole('button')
                        .first()
                        .click(),
            });
        });

        test.describe('filters', () => {
            const filterChips: AllowRule[] = [
                // Adding the first filter adds the chip row: the toolbar grows and
                // everything below it moves, once, at the input.
                {
                    anchor: /^(toolbar|header:.*|row:.*|body|footer|content)$/,
                    props: ['y', 'height'],
                    label: /^(add|remove) filter|^held:/,
                },
            ];

            async function addStatusFilter(page: Page) {
                await page.getByTestId('dt-add-filter-trigger').click();
                await page.getByRole('menuitem', { name: 'Status' }).click();
                await page
                    .getByRole('dialog', { name: 'Filter by Status' })
                    .getByRole('button', { name: 'Apply filter' })
                    .click();
            }

            test('add a filter', async ({ layout }) => {
                layout.network.rewrite(LIST, listVariant('fullPage'));
                await once(layout, {
                    name: 'add filter',
                    prepare: openList,
                    trigger: ({ page }) => addStatusFilter(page),
                    allow: filterChips,
                });
            });

            test('remove a filter', async ({ layout }) => {
                layout.network.rewrite(LIST, listVariant('fullPage'));
                await once(layout, {
                    name: 'remove filter',
                    prepare: async ctx => {
                        await openList(ctx);
                        await addStatusFilter(ctx.page);
                        await settle(ctx);
                    },
                    trigger: ({ page }) =>
                        page.locator('[data-slot="chip-remove"]').first().click(),
                    allow: filterChips,
                });
            });
        });

        test('search typing', async ({ layout }) => {
            layout.network.rewrite(LIST, listVariant('fullPage'));
            await once(layout, {
                name: 'search',
                prepare: openList,
                trigger: ({ page }) =>
                    page
                        .getByRole('textbox', { name: /^Search/ })
                        .first()
                        .pressSequentially('lap', { delay: 50 }),
            });
        });

        test('search with no match shows the empty state in place', async ({ layout }) => {
            await once(layout, {
                name: 'search with no match',
                prepare: openList,
                trigger: ({ page }) =>
                    page
                        .getByRole('textbox', { name: /^Search/ })
                        .first()
                        .fill('no-product-matches-this'),
                allow: ROWS_BELOW_MAY_MOVE,
            });
        });

        test('row selection shows the bulk-action bar', async ({ layout }) => {
            await once(layout, {
                name: 'select a row',
                requests: false,
                prepare: openList,
                trigger: async ({ page }) => {
                    await page
                        .locator(`${TABLE} tbody tr`)
                        .first()
                        .getByRole('checkbox')
                        .click({ force: true });
                    await page.getByRole('toolbar', { name: 'Bulk actions' }).waitFor();
                },
            });
        });

        test.describe('delete', () => {
            // A tuple, so Playwright does not read the array as [value, options].
            test.use({ anchors: [[...LIST_PAGE_ANCHORS, EVERY_ROW], { scope: 'test' }] });

            test('deleting a row moves only the rows below it', async ({ layout }) => {
                const deleted = new Set<string>();
                layout.network.rewrite(LIST, (data, variables) => {
                    const items = data.products.items.filter((item: any) => !deleted.has(item.id));
                    const take = Number(variables?.options?.take) || 10;
                    return {
                        ...data,
                        products: { items: fillPage(items, take), totalItems: 120 - deleted.size },
                    };
                });
                // The server keeps the product: other specs share its data.
                layout.network.fake('DeleteProduct', () => ({
                    deleteProduct: { result: 'DELETED', message: null },
                }));
                layout.network.fake('DeleteProducts', vars => ({
                    deleteProducts: (vars.ids ?? []).map(() => ({ result: 'DELETED', message: null })),
                }));
                const index = 2;
                await once(layout, {
                    name: 'delete the third row',
                    prepare: openList,
                    trigger: async ({ page }) => {
                        const row = page.locator(`${TABLE} tbody tr`).nth(index);
                        const id = (
                            await row.locator('[data-slot="data-table-row-link"]').getAttribute('href')
                        )
                            ?.split('/')
                            .pop();
                        if (id) deleted.add(id);
                        await row.getByTestId('dt-row-actions-trigger').click();
                        await page.locator('[role="menu"]').getByText('Delete', { exact: true }).click();
                        await page
                            .locator('[role="alertdialog"]')
                            .getByRole('button', { name: 'Delete' })
                            .click();
                    },
                    // Rows from the deleted one down may change; nothing above it.
                    allow: [{ anchor: new RegExp(`^rows:(${rowsFrom(index)})$`) }],
                });
            });
        });
    });
}
