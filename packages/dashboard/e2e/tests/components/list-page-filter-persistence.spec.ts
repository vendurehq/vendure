import { type Page, expect, test } from '@playwright/test';

import { BaseListPage } from '../../page-objects/list-page.base.js';

// Must match `LS_KEY_USER_SETTINGS` in src/lib/constants.ts. Inlined rather than imported:
// that module pulls in the generated GraphQL schema enums, which do not belong in the
// Playwright process.
const USER_SETTINGS_KEY = 'vendure-user-settings';
const PAGE_ID = 'product-list';

/** Reads the saved table settings for a page. */
async function readSavedTableSettings(page: Page, pageId: string) {
    return page.evaluate(
        ([key, id]) => JSON.parse(localStorage.getItem(key) || '{}').tableSettings?.[id] ?? {},
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

        const saved = await readSavedTableSettings(page, PAGE_ID);
        expect(saved).not.toHaveProperty('columnFilters');
        expect(saved).not.toHaveProperty('columnFiltersConfigured');
    });

    // #5294 — clearing every filter is saved as a choice, so `defaultColumnFilters` stay away
    test('should save cleared filters as configured and keep them across a reload', async ({ page }) => {
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

        const afterFiltering = await readSavedTableSettings(page, PAGE_ID);
        expect(afterFiltering.columnFilters).toHaveLength(1);
        expect(afterFiltering.columnFiltersConfigured).toBe(true);

        await Promise.all([
            waitForProductList(page),
            page.getByRole('button', { name: 'Clear all' }).click(),
        ]);
        await lp.expectRowCount(initialCount);

        const afterClearing = await readSavedTableSettings(page, PAGE_ID);
        expect(afterClearing.columnFilters).toEqual([]);
        expect(afterClearing.columnFiltersConfigured).toBe(true);

        await page.reload();
        await lp.expectLoaded();
        await lp.expectRowsLoaded();
        await lp.expectRowCount(initialCount);

        const afterReload = await readSavedTableSettings(page, PAGE_ID);
        expect(afterReload.columnFilters).toEqual([]);
        expect(afterReload.columnFiltersConfigured).toBe(true);
    });
});

test.describe('List page default column filters', () => {
    // Declared by the e2e fixture `default-filters-test-dashboard`, with a default filter
    // of `name contains "Camera"`.
    const DEFAULTS_PAGE_ID = 'default-filters-test';

    function defaultsList(page: Page) {
        return new BaseListPage(page, {
            path: '/default-filters-test',
            title: 'Default filters test',
            newButtonLabel: 'New',
        });
    }

    async function openAsFirstVisit(page: Page, savedColumnFilters?: unknown[]) {
        const lp = defaultsList(page);
        await lp.goto();
        await lp.expectLoaded();
        await resetSavedTableSettings(page, DEFAULTS_PAGE_ID);
        if (savedColumnFilters) {
            await page.evaluate(
                ([key, id, value]) => {
                    const settings = JSON.parse(localStorage.getItem(key) || '{}');
                    settings.tableSettings = { ...settings.tableSettings, [id]: { columnFilters: value } };
                    localStorage.setItem(key, JSON.stringify(settings));
                },
                [USER_SETTINGS_KEY, DEFAULTS_PAGE_ID, savedColumnFilters] as const,
            );
        }
        await page.reload();
        await lp.expectLoaded();
        await lp.expectRowsLoaded();
        return lp;
    }

    async function expectOnlyCameraRows(lp: BaseListPage) {
        const names = await lp.getRows().allInnerTexts();
        expect(names.length).toBeGreaterThan(0);
        for (const name of names) {
            expect(name).toContain('Camera');
        }
    }

    // #5294 — a first visit applies the page's default filters to both the chips and the query
    test('should apply the default filters on a first visit', async ({ page }) => {
        const lp = await openAsFirstVisit(page);
        await expect(page.getByRole('button', { name: 'Clear all' })).toBeVisible();
        await expectOnlyCameraRows(lp);

        const saved = await readSavedTableSettings(page, DEFAULTS_PAGE_ID);
        expect(saved).not.toHaveProperty('columnFilters');
    });

    // #5294 — the empty array older versions saved on mount does not suppress the defaults
    test('should apply the default filters over a legacy empty saved state', async ({ page }) => {
        const lp = await openAsFirstVisit(page, []);
        await expect(page.getByRole('button', { name: 'Clear all' })).toBeVisible();
        await expectOnlyCameraRows(lp);
    });

    // #5294 — clearing the default filters sticks across a reload
    test('should keep the default filters cleared after a reload', async ({ page }) => {
        const lp = await openAsFirstVisit(page);
        const filteredCount = await lp.getRows().count();

        await Promise.all([
            waitForProductList(page),
            page.getByRole('button', { name: 'Clear all' }).click(),
        ]);
        await expect(page.getByRole('button', { name: 'Clear all' })).toBeHidden();
        expect(await lp.getRows().count()).toBeGreaterThan(filteredCount);

        await page.reload();
        await lp.expectLoaded();
        await lp.expectRowsLoaded();
        await expect(page.getByRole('button', { name: 'Clear all' })).toBeHidden();
        expect(await lp.getRows().count()).toBeGreaterThan(filteredCount);

        const saved = await readSavedTableSettings(page, DEFAULTS_PAGE_ID);
        expect(saved.columnFilters).toEqual([]);
        expect(saved.columnFiltersConfigured).toBe(true);
    });
});
