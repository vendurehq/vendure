import { type Page, expect, test } from '@playwright/test';

import { BaseListPage } from '../../page-objects/list-page.base.js';

// Regression: https://github.com/vendurehq/vendure/issues/5253
//
// The draft order page's eligible-shipping-methods query
// (queryKey: ['eligibleShippingMethods', orderId]) was never invalidated
// after mutations that can change shipping eligibility (adding/removing a
// customer's shipping address). The shipping method dropdown kept showing
// no options -- or a stale list -- until the page was reloaded.

test.describe('Issue #5253: Draft order eligible shipping methods refresh', () => {
    test.describe.configure({ mode: 'serial' });

    const listPage = (page: Page) =>
        new BaseListPage(page, {
            path: '/orders',
            title: 'Orders',
            newButtonLabel: 'Draft order',
            newButtonRole: 'button',
        });

    test('should show eligible shipping methods after setting a customer with a shipping address', async ({
        page,
    }) => {
        test.setTimeout(60_000);

        // Create a draft order
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await lp.newButton.click();
        await expect(page).toHaveURL(/\/orders\/draft\//, { timeout: 10_000 });

        // Add a product so the order has a shippable line
        const addItemButton = page.locator('[role="combobox"]').filter({ hasText: 'Add item to order' });
        await addItemButton.scrollIntoViewIfNeeded();
        await addItemButton.click();
        await page.getByPlaceholder('Add item to order...').fill('laptop');
        await expect(page.getByRole('option').first()).toBeVisible({ timeout: 5_000 });
        await page.getByRole('option').first().click();
        await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);

        // Setting a customer with a default shipping address should populate the
        // order's shipping address and, without the fix, leave the shipping
        // method dropdown stuck on "no methods available" until a manual reload.
        await page.getByRole('button', { name: /Select customer/i }).click();
        await page.getByPlaceholder('Search customers...').fill('hayden');
        await expect(page.getByRole('option').first()).toBeVisible({ timeout: 5_000 });
        await page.getByRole('option').first().click();
        await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);

        const shippingMethodSelect = page.locator('[role="combobox"]').filter({ hasText: /shipping method/i });
        await expect(shippingMethodSelect).toBeVisible({ timeout: 10_000 });
        await shippingMethodSelect.click();
        await expect(page.getByRole('option').first()).toBeVisible({ timeout: 10_000 });

        // Clean up: delete the draft
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: /Delete draft/i }).click();
        await page.locator('[role="alertdialog"]').getByRole('button', { name: 'Continue' }).click();
        await expect(page).not.toHaveURL(/\/draft\//, { timeout: 15_000 });
    });
});
