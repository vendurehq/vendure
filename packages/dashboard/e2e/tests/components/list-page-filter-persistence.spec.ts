import { type Page, expect, test } from '@playwright/test';

import { BaseListPage } from '../../page-objects/list-page.base.js';

// Must match `LS_KEY_USER_SETTINGS` in src/lib/constants.ts. Inlined rather than imported:
// that module pulls in the generated GraphQL schema enums, which do not belong in the
// Playwright process.
const USER_SETTINGS_KEY = 'vendure-user-settings';
const PAGE_ID = 'product-list';

/**
 * Reads the saved column filters for a page. `saved` is what distinguishes "no value has
 * been saved" from a saved `null` — the "user cleared every filter" sentinel — since
 * `undefined` cannot survive the trip out of `page.evaluate` and both arrive as `null`.
 */
async function readSavedColumnFilters(page: Page, pageId: string) {
    return page.evaluate(
        ([key, id]) => {
            const settings = JSON.parse(localStorage.getItem(key) || '{}');
            const tableSettings = settings.tableSettings?.[id] ?? {};
            return {
                saved: Object.prototype.hasOwnProperty.call(tableSettings, 'columnFilters'),
                value: tableSettings.columnFilters ?? null,
            };
        },
        [USER_SETTINGS_KEY, pageId] as const,
    );
}

/**
 * Puts the page back into the "user has never configured filters here" state that a
 * first-time visitor sees. The stored auth state is shared between tests, so the saved
 * settings cannot be assumed to be empty at the start of a test.
 */
async function resetSavedTableSettings(page: Page, pageId: string) {
    await page.evaluate(
        ([key, id]) => {
            const settings = JSON.parse(localStorage.getItem(key) || '{}');
            if (settings.tableSettings) {
                delete settings.tableSettings[id];
            }
            localStorage.setItem(key, JSON.stringify(settings));
        },
        [USER_SETTINGS_KEY, pageId] as const,
    );
}

/**
 * Waits for the products list query itself to come back, rather than for any admin-api
 * response — the dashboard has other requests in flight (user settings, saved views), and
 * matching one of those would let the assertions run against a list that has not refreshed.
 *
 * Returns the pending wait, so callers can register it before the action that triggers the
 * refetch; awaiting it afterwards would race the response.
 */
function waitForProductList(page: Page) {
    return page.waitForResponse(
        resp =>
            resp.url().includes('/admin-api') &&
            resp.request().postData()?.includes('ProductList') === true &&
            resp.status() === 200,
    );
}

function productList(page: Page) {
    return new BaseListPage(page, {
        path: '/products',
        title: 'Products',
        newButtonLabel: 'New Product',
    });
}

async function applyNameFilter(page: Page, value: string) {
    const lp = productList(page);
    await lp.openAddFilterMenu();
    const dropdown = page.locator('[data-slot="dropdown-menu-content"]');
    await expect(dropdown).toBeVisible();
    await dropdown.getByRole('menuitem', { name: /name/i }).click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder('Enter filter value...').fill(value);
    await Promise.all([
        waitForProductList(page),
        dialog.getByRole('button', { name: 'Apply filter' }).click(),
    ]);
}

test.describe('List page column filter persistence', () => {
    // #5294 — `ListPage`'s `defaultColumnFilters` applies a page's default filters only until
    // the user configures their own, which requires the saved table settings to tell "never
    // configured filters here" apart from "cleared every filter". Both used to be an empty
    // array, because the data table reported its filter state on mount and the list page
    // persisted whatever it was told. Merely visiting now saves nothing at all.
    test('should not save a filter state merely because the list page was visited', async ({ page }) => {
        const lp = productList(page);
        await lp.goto();
        await lp.expectLoaded();

        // Start from a clean slate, then load the page as a first-time visitor would.
        await resetSavedTableSettings(page, PAGE_ID);
        await page.reload();
        await lp.expectLoaded();
        await lp.expectRowsLoaded();

        const savedFilters = await readSavedColumnFilters(page, PAGE_ID);
        expect(savedFilters.saved).toBe(false);
    });

    // #5294 — clearing every filter is a deliberate choice and has to be saved as such, so
    // that a page's `defaultColumnFilters` are not re-applied on the next visit. It is saved
    // as `null` rather than `[]`, which is the value older versions wrote on mount and so
    // cannot mean anything.
    test('should save cleared filters as null and keep it across a reload', async ({ page }) => {
        const lp = productList(page);
        await lp.goto();
        await lp.expectLoaded();

        await resetSavedTableSettings(page, PAGE_ID);
        await page.reload();
        await lp.expectLoaded();
        await lp.expectRowsLoaded();

        const initialCount = await lp.getRows().count();

        await applyNameFilter(page, 'Camera');
        const filteredCount = await lp.getRows().count();
        expect(filteredCount).toBeLessThan(initialCount);

        const afterFiltering = await readSavedColumnFilters(page, PAGE_ID);
        expect(afterFiltering.saved).toBe(true);
        expect(afterFiltering.value).toHaveLength(1);

        await Promise.all([
            waitForProductList(page),
            page.getByRole('button', { name: 'Clear all' }).click(),
        ]);
        await lp.expectRowCount(initialCount);

        // Saved as `null`: the user has configured the filters and chosen to have none.
        const afterClearing = await readSavedColumnFilters(page, PAGE_ID);
        expect(afterClearing.saved).toBe(true);
        expect(afterClearing.value).toBeNull();

        await page.reload();
        await lp.expectLoaded();
        await lp.expectRowsLoaded();
        await lp.expectRowCount(initialCount);

        const afterReload = await readSavedColumnFilters(page, PAGE_ID);
        expect(afterReload.saved).toBe(true);
        expect(afterReload.value).toBeNull();
    });
});
