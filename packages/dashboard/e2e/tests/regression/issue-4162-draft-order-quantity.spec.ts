import { type Page, expect, test } from '@playwright/test';

import { BaseListPage } from '../../page-objects/list-page.base.js';

// Regression: https://github.com/vendurehq/vendure/issues/4162
// Fix PR: https://github.com/vendurehq/vendure/pull/4345
//
// In a draft order, changing a line item's quantity to 0 or clearing the field
// immediately removes the product. Mutations also fire on every keystroke,
// causing toast spam. The fix defers updates to Enter/blur.

test.describe('Issue #4162: Draft order quantity editing', () => {
    test.describe.configure({ mode: 'serial' });

    const listPage = (page: Page) =>
        new BaseListPage(page, {
            path: '/orders',
            title: 'Orders',
            newButtonLabel: 'Draft order',
            newButtonRole: 'button',
        });

    test.fixme('should not remove product when clearing quantity field', async ({ page }) => {
        test.setTimeout(60_000);

        // Create a draft and add a product
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await lp.newButton.click();
        await expect(page).toHaveURL(/\/orders\/draft\//, { timeout: 10_000 });

        // Set a customer
        await page.getByRole('button', { name: /Select customer/i }).click();
        await page.getByPlaceholder('Search customers...').fill('hayden');
        await expect(page.getByRole('option').first()).toBeVisible({ timeout: 5_000 });
        await page.getByRole('option').first().click();
        await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);

        // Add a product
        const addItemButton = page.locator('[role="combobox"]').filter({ hasText: 'Add item to order' });
        await addItemButton.scrollIntoViewIfNeeded();
        await addItemButton.click();
        await page.getByPlaceholder('Add item to order...').fill('laptop');
        await expect(page.getByRole('option').first()).toBeVisible({ timeout: 5_000 });
        await page.getByRole('option').first().click();
        await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);

        // Verify the product is in the table
        await expect(page.getByText('Laptop', { exact: false })).toBeVisible();
        const quantityInput = page.getByRole('spinbutton');
        await expect(quantityInput).toHaveValue('1');

        // Clear the quantity field (simulating user selecting all and deleting)
        await quantityInput.click();
        await quantityInput.fill('');

        // Click elsewhere to blur — the product should NOT be removed
        await page.getByRole('heading', { level: 1 }).click();
        await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);

        // The product should still be visible (quantity reverts to previous value on blur)
        await expect(page.getByText('Laptop', { exact: false })).toBeVisible();

        // Clean up: delete the draft
        await page.getByRole('button', { name: /Delete draft/i }).click();
        await page.locator('[role="alertdialog"]').getByRole('button', { name: 'Continue' }).click();
        await expect(page).not.toHaveURL(/\/draft\//, { timeout: 15_000 });
    });
});
