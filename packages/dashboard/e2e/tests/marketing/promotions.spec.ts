import { type Page, expect, test } from '@playwright/test';

import { BaseDetailPage } from '../../page-objects/detail-page.base.js';
import { BaseListPage } from '../../page-objects/list-page.base.js';

// Promotions require ConfigurableOperationMultiSelectors for conditions and actions.
// We use the simplest built-in operations:
//   Condition: "minimum_order_amount" (has default args)
//   Action: "free_shipping" (zero args)

test.describe('Promotions CRUD', () => {
    test.describe.configure({ mode: 'serial' });

    const listPage = (page: Page) =>
        new BaseListPage(page, {
            path: '/promotions',
            title: 'Promotions',
            newButtonLabel: 'New Promotion',
        });

    const detailPage = (page: Page) =>
        new BaseDetailPage(page, {
            newPath: '/promotions/new',
            pathPrefix: '/promotions/',
            newTitle: 'New promotion',
        });

    test('should display the promotions list page', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
    });

    test('should navigate to create form', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await lp.clickNewButton();
        await expect(page).toHaveURL(/\/promotions\/new/);
        await expect(page.getByRole('heading', { name: 'New promotion' })).toBeVisible();
    });

    test('should create a new promotion', async ({ page }) => {
        const dp = detailPage(page);
        await dp.gotoNew();
        await dp.expectNewPageLoaded();

        await dp.fillInput('Name', 'E2E Test Promotion');

        // Add a condition — ConfigurableOperationMultiSelector (DropdownMenu)
        await page.getByRole('button', { name: 'Add condition' }).click();
        await page.getByRole('menuitem', { name: /order total is greater than/ }).click();

        // Add an action — ConfigurableOperationMultiSelector (DropdownMenu)
        await page.getByRole('button', { name: 'Add action' }).click();
        await page.getByRole('menuitem', { name: /Free shipping/ }).click();

        await dp.clickCreate();
        await dp.expectSuccessToast(/Successfully created promotion/);
        await dp.expectNavigatedToExisting();
    });

    test('should find the created promotion via search', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await lp.search('E2E Test Promotion');
        await expect(lp.getRows().filter({ hasText: 'E2E Test Promotion' }).first()).toBeVisible();
    });

    test('should navigate to promotion detail page', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await lp.search('E2E Test Promotion');
        await lp.clickEntity('E2E Test Promotion');
        await expect(page).toHaveURL(/\/promotions\/[^/]+$/);
    });

    test('should edit a condition arg via the sentence chip popover', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await lp.search('E2E Test Promotion');
        await lp.clickEntity('E2E Test Promotion');
        await expect(page).toHaveURL(/\/promotions\/[^/]+$/);

        const dp = detailPage(page);

        // The condition renders as a sentence with the amount and active
        // channel currency as a chip (default value 100 minor units → $1.00).
        const amountChip = page.getByRole('button', { name: 'amount' });
        await expect(amountChip).toHaveText('$1.00');

        // Edit the amount in the chip popover — changes apply live.
        // (MoneyInput does not forward the name attribute, so locate the
        // input via its labelled field wrapper.)
        await amountChip.click();
        await page
            .locator('[data-slot="field"]')
            .filter({ hasText: 'amount' })
            .getByRole('textbox')
            .fill('50');
        await page.keyboard.press('Escape');
        await expect(amountChip).toHaveText('$50.00');

        await dp.clickUpdate();
        await dp.expectSuccessToast(/Successfully updated promotion/);

        // The edited value persists across a reload
        await page.reload();
        await expect(page.getByRole('button', { name: 'amount' })).toHaveText('$50.00');
    });

    test('should update the promotion', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await lp.search('E2E Test Promotion');
        await lp.clickEntity('E2E Test Promotion');
        await expect(page).toHaveURL(/\/promotions\/[^/]+$/);

        const dp = detailPage(page);
        await dp.fillInput('Name', 'E2E Updated Promotion');
        await dp.clickUpdate();
        await dp.expectSuccessToast(/Successfully updated promotion/);
    });

    test('should show updated promotion in the list', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await lp.search('E2E Updated Promotion');
        await expect(lp.getRows().filter({ hasText: 'E2E Updated Promotion' }).first()).toBeVisible();
    });

    test('should bulk-delete the test promotion', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await lp.search('E2E Updated Promotion');

        await lp.bulkDelete('all');
        await lp.expectSuccessToast();
    });
});
