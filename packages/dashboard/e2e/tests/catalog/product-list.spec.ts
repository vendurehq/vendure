import { expect, test } from '@playwright/test';

import { BaseListPage } from '../../page-objects/list-page.base.js';

test.describe('Product List', () => {
    const listPage = (page: import('@playwright/test').Page) =>
        new BaseListPage(page, {
            path: '/products',
            title: 'Products',
            newButtonLabel: 'New Product',
        });

    test('should display the product list page', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
    });

    test('should show products in the table', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();

        const rows = lp.getRows();
        await expect(rows.first()).toBeVisible();
        expect(await rows.count()).toBeGreaterThan(0);
    });

    test('should navigate to product detail when clicking a product', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();

        // Click the first product button in the table (Base UI Button renders role="button")
        const firstProductLink = lp.getRows().first().getByRole('button').first();
        await firstProductLink.click();

        await expect(page).toHaveURL(/\/products\/.+/);
    });

    test('should display "New Product" button', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();

        await expect(lp.newButton).toBeVisible();
    });

    // #4393 — product list should default to sorting by updatedAt descending
    test('should apply descending updatedAt sort by default', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();

        const url = new URL(page.url());
        const sort = url.searchParams.get('sort');
        expect(sort).toContain('-updatedAt');
    });

    // #4408 — Facet value filter on product list
    test.describe('Facet value filter', () => {
        test('should display facets in browse mode and filter products by facet value', async ({ page }) => {
            const lp = listPage(page);
            await lp.goto();
            await lp.expectLoaded();

            // Click the "Facet values" filter button in the toolbar
            const facetFilterButton = page.getByRole('button', { name: 'Facet values' });
            await expect(facetFilterButton).toBeVisible();
            await facetFilterButton.click();

            // The popover should open showing facets in browse mode
            const popover = page.locator('[data-slot="popover-content"]');
            await expect(popover).toBeVisible({ timeout: 5_000 });
            await expect(popover.getByText('Facets')).toBeVisible();

            // Should show the "category" facet
            const categoryItem = popover.getByRole('option', { name: 'category' });
            await expect(categoryItem).toBeVisible();

            // Click into the "category" facet to see its values
            await categoryItem.click();

            // Should show the back button and facet values
            await expect(popover.getByRole('option', { name: 'Back' })).toBeVisible();

            // Select "photo" facet value
            const photoItem = popover.getByRole('option', { name: 'photo' });
            await expect(photoItem).toBeVisible();
            await photoItem.click();

            // Wait for the filtered results to load
            await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);

            // Close the popover by pressing Escape
            await page.keyboard.press('Escape');

            // Should show exactly the 4 products with the "photo" facet value
            await lp.expectRowCount(4);
            const expectedProducts = ['Camera Lens', 'Instant Camera', 'Slr Camera', 'Tripod'];
            for (const name of expectedProducts) {
                await expect(lp.getRows().filter({ hasText: name })).toHaveCount(1);
            }

            // The filter button should now show the selected facet value label
            await expect(facetFilterButton).toContainText('photo');
        });

        test('should persist facet value names after page reload', async ({ page }) => {
            const lp = listPage(page);
            await lp.goto();
            await lp.expectLoaded();

            // Open facet filter and select a value
            const facetFilterButton = page.getByRole('button', { name: 'Facet values' });
            await facetFilterButton.click();

            const popover = page.locator('[data-slot="popover-content"]');
            await expect(popover).toBeVisible({ timeout: 5_000 });

            // Drill into "category" facet
            await popover.getByRole('option', { name: 'category' }).click();
            await expect(popover.getByRole('option', { name: 'Back' })).toBeVisible();

            // Select "electronics"
            await popover.getByRole('option', { name: 'electronics' }).click();
            await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);
            await page.keyboard.press('Escape');

            // Verify the badge shows the name, not an ID
            await expect(facetFilterButton).toContainText('electronics');

            // Reload the page
            await page.reload();
            await lp.expectLoaded();

            // After reload, the filter button should still show the facet value name
            const reloadedButton = page.getByRole('button', { name: /Facet values/ });
            await expect(reloadedButton).toContainText('electronics');
            // Ensure it does NOT show a numeric ID instead of the name
            await expect(reloadedButton).not.toContainText(/^\d+$/);
        });

        test('should clear facet value filter', async ({ page }) => {
            const lp = listPage(page);
            await lp.goto();
            await lp.expectLoaded();

            const initialRowCount = await lp.getRows().count();

            // Open facet filter and select a value
            const facetFilterButton = page.getByRole('button', { name: 'Facet values' });
            await facetFilterButton.click();

            const popover = page.locator('[data-slot="popover-content"]');
            await expect(popover).toBeVisible({ timeout: 5_000 });
            await popover.getByRole('option', { name: 'category' }).click();
            await popover.getByRole('option', { name: 'electronics' }).click();
            await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);

            // Close and reopen to access "Clear filters"
            await page.keyboard.press('Escape');

            // Reopen the filter
            await facetFilterButton.click();
            await expect(popover).toBeVisible({ timeout: 5_000 });

            // Click "Clear filters"
            await popover.getByRole('option', { name: 'Clear filters' }).click();
            await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);

            // The list should now show all products again
            await expect(lp.getRows()).toHaveCount(initialRowCount);
        });

        test('should search facet values by name', async ({ page }) => {
            const lp = listPage(page);
            await lp.goto();
            await lp.expectLoaded();

            // Open the facet filter
            const facetFilterButton = page.getByRole('button', { name: 'Facet values' });
            await facetFilterButton.click();

            const popover = page.locator('[data-slot="popover-content"]');
            await expect(popover).toBeVisible({ timeout: 5_000 });

            // Type in the search box
            const searchInput = popover.getByPlaceholder('Search facet values...');
            await searchInput.fill('electr');

            // Wait for search results
            await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);

            // Should show "electronics" in the search results
            await expect(popover.getByRole('option', { name: 'electronics' })).toBeVisible();
        });
    });

    // #4393 — Reset button should be visible (outside scroll area) in column settings
    test('should show the Reset button in the column settings dropdown', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();

        // The column settings trigger is the gear icon (Settings2) in the data table toolbar.
        // We exclude sidebar buttons (which also use Settings2) via :not([data-sidebar]).
        const columnSettingsTrigger = page.getByTestId('dt-column-settings-trigger');
        await columnSettingsTrigger.click();

        const dropdownContent = page.locator('[data-slot="dropdown-menu-content"]');
        await expect(dropdownContent).toBeVisible();

        const resetItem = page.getByRole('menuitem', { name: 'Reset' });
        await expect(resetItem).toBeVisible();
    });

    test.describe('Data table features', () => {
        test('should sort by name ascending when clicking column header', async ({ page }) => {
            const lp = listPage(page);
            await lp.goto();
            await lp.expectLoaded();

            await lp.clickColumnSort('Name');

            const url = new URL(page.url());
            const sort = url.searchParams.get('sort');
            expect(sort).toContain('name');
        });

        test('should toggle sort direction on repeated click', async ({ page }) => {
            const lp = listPage(page);
            await lp.goto();
            await lp.expectLoaded();

            // First click → ascending
            await lp.clickColumnSort('Name');
            let sort = new URL(page.url()).searchParams.get('sort');
            expect(sort).toBe('name');

            // Second click → descending
            await lp.clickColumnSort('Name');
            sort = new URL(page.url()).searchParams.get('sort');
            expect(sort).toBe('-name');
        });

        test('should navigate to page 2 via next page button', async ({ page }) => {
            const lp = listPage(page);
            await lp.goto();
            await lp.expectLoaded();

            // Capture page 1 row texts
            const page1Rows = await lp.getRows().allTextContents();
            expect(page1Rows.length).toBeGreaterThan(0);

            // Navigate to page 2
            await lp.clickNextPage();

            // URL should reflect page 2
            const url = new URL(page.url());
            expect(url.searchParams.get('page')).toBe('2');

            // Page 2 rows should be different from page 1
            const page2Rows = await lp.getRows().allTextContents();
            expect(page2Rows.length).toBeGreaterThan(0);
            expect(page2Rows[0]).not.toBe(page1Rows[0]);
        });

        test('should change rows per page', async ({ page }) => {
            const lp = listPage(page);
            await lp.goto();
            await lp.expectLoaded();

            const initialCount = await lp.getRows().count();
            expect(initialCount).toBeLessThanOrEqual(10);

            // Open the page size select and choose 20
            await lp.getPageSizeSelect().click();
            await page.getByRole('option', { name: '20' }).click();
            await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);

            // Should now show more rows (seed data has 20+ products)
            const newCount = await lp.getRows().count();
            expect(newCount).toBeGreaterThan(initialCount);
        });

        test('should hide a column via column settings', async ({ page }) => {
            const lp = listPage(page);
            await lp.goto();
            await lp.expectLoaded();

            // Verify the "Slug" column header is visible
            await expect(lp.dataTable.locator('thead th').filter({ hasText: 'Slug' })).toBeVisible();

            // Open column settings and uncheck the "slug" column
            await lp.openColumnSettings();
            const dropdownContent = page.locator('[data-slot="dropdown-menu-content"]');
            await expect(dropdownContent).toBeVisible();

            const slugCheckbox = page.getByRole('menuitemcheckbox', { name: /slug/i });
            await slugCheckbox.click();

            // Close the dropdown
            await page.keyboard.press('Escape');

            // The "Slug" column should no longer be visible
            await expect(lp.dataTable.locator('thead th').filter({ hasText: 'Slug' })).toBeHidden();

            // Reset column settings to restore
            await lp.openColumnSettings();
            await page.getByRole('menuitem', { name: 'Reset' }).click();
        });

        test('should add and apply a string filter', async ({ page }) => {
            const lp = listPage(page);
            await lp.goto();
            await lp.expectLoaded();

            const initialCount = await lp.getRows().count();

            // Open the add filter menu
            await lp.openAddFilterMenu();
            const dropdown = page.locator('[data-slot="dropdown-menu-content"]');
            await expect(dropdown).toBeVisible();

            // Select "name" column to filter
            await dropdown.getByRole('menuitem', { name: /name/i }).click();

            // The filter dialog should open
            const dialog = page.locator('[role="dialog"]');
            await expect(dialog).toBeVisible();

            // Default operator is "contains" — fill in a filter value
            await dialog.getByPlaceholder('Enter filter value...').fill('Camera');

            // Apply the filter
            await dialog.getByRole('button', { name: 'Apply filter' }).click();

            // Wait for filtered results
            await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);

            // Should show fewer rows than before
            const filteredCount = await lp.getRows().count();
            expect(filteredCount).toBeLessThan(initialCount);
            expect(filteredCount).toBeGreaterThan(0);

            // A filter badge should appear in the toolbar
            await expect(
                page
                    .locator('div')
                    .filter({ hasText: /name.*contains/i })
                    .first(),
            ).toBeVisible();
        });

        test('should clear an applied filter via the clear all button', async ({ page }) => {
            const lp = listPage(page);
            await lp.goto();
            await lp.expectLoaded();

            const initialCount = await lp.getRows().count();

            // Apply a filter first
            await lp.openAddFilterMenu();
            const dropdown = page.locator('[data-slot="dropdown-menu-content"]');
            await dropdown.getByRole('menuitem', { name: /name/i }).click();

            const dialog = page.locator('[role="dialog"]');
            await dialog.getByPlaceholder('Enter filter value...').fill('Camera');
            await dialog.getByRole('button', { name: 'Apply filter' }).click();
            await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);

            const filteredCount = await lp.getRows().count();
            expect(filteredCount).toBeLessThan(initialCount);

            // Click "Clear all" to remove the filter
            await page.getByRole('button', { name: 'Clear all' }).click();
            await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);

            // Row count should return to the initial count
            await lp.expectRowCount(initialCount);
        });

        test('should apply a boolean filter', async ({ page }) => {
            const lp = listPage(page);
            await lp.goto();
            await lp.expectLoaded();

            const initialCount = await lp.getRows().count();

            // Open the add filter menu and select "enabled" column
            await lp.openAddFilterMenu();
            const dropdown = page.locator('[data-slot="dropdown-menu-content"]');
            await dropdown.getByRole('menuitem', { name: /enabled/i }).click();

            // The filter dialog should open with boolean filter controls
            const dialog = page.locator('[role="dialog"]');
            await expect(dialog).toBeVisible();

            // Default: operator "is equal to", value "True"
            // Apply the filter as-is (enabled = true)
            await dialog.getByRole('button', { name: 'Apply filter' }).click();
            await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);

            // All visible rows should be enabled products
            const filteredCount = await lp.getRows().count();
            expect(filteredCount).toBeGreaterThan(0);
            expect(filteredCount).toBeLessThanOrEqual(initialCount);

            // Clean up: clear the filter
            await page.getByRole('button', { name: 'Clear all' }).click();
            await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);
        });
    });
});
