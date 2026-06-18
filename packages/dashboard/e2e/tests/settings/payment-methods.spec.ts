import { type Page, expect, test } from '@playwright/test';

import { BaseDetailPage } from '../../page-objects/detail-page.base.js';
import { BaseListPage } from '../../page-objects/list-page.base.js';

// Payment Methods require ConfigurableOperation handler selectors.
// The eligibility checker is optional; only the handler is required.

test.describe('Payment Methods CRUD', () => {
    test.describe.configure({ mode: 'serial' });

    const listPage = (page: Page) =>
        new BaseListPage(page, {
            path: '/payment-methods',
            title: 'Payment Methods',
            newButtonLabel: 'New Payment Method',
        });

    const detailPage = (page: Page) =>
        new BaseDetailPage(page, {
            newPath: '/payment-methods/new',
            pathPrefix: '/payment-methods/',
            newTitle: 'New payment method',
        });

    test('should display the payment methods list page', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
    });

    test('should navigate to create form', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await lp.clickNewButton();
        await expect(page).toHaveURL(/\/payment-methods\/new/);
        await expect(page.getByRole('heading', { name: 'New payment method' })).toBeVisible();
    });

    test('should create a new payment method', async ({ page }) => {
        const dp = detailPage(page);
        await dp.gotoNew();
        await dp.expectNewPageLoaded();

        await dp.fillInput('Name', 'E2E Test Payment');
        await dp.fillInput('Code', 'e2e-test-payment');

        // Payment Handler — ConfigurableOperationSelector (DropdownMenu)
        // Only the dummy handler is available in dev/test
        await page.getByRole('button', { name: 'Select Payment Handler' }).click();
        await page.getByRole('menuitem', { name: /dummy payment/i }).click();

        await dp.clickCreate();
        await dp.expectSuccessToast(/Successfully created payment method/);
        await dp.expectNavigatedToExisting();
    });

    test('should find the created payment method via search', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await lp.search('E2E Test Payment');
        await expect(lp.getRows().filter({ hasText: 'E2E Test Payment' }).first()).toBeVisible();
    });

    test('should navigate to payment method detail page', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await lp.search('E2E Test Payment');
        await lp.clickEntity('E2E Test Payment');
        await expect(page).toHaveURL(/\/payment-methods\/[^/]+$/);
    });

    test('should update the payment method', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await lp.search('E2E Test Payment');
        await lp.clickEntity('E2E Test Payment');
        await expect(page).toHaveURL(/\/payment-methods\/[^/]+$/);

        const dp = detailPage(page);
        await dp.fillInput('Name', 'E2E Updated Payment');
        await dp.clickUpdate();
        await dp.expectSuccessToast(/Successfully updated payment method/);
    });

    test('should show updated payment method in the list', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await lp.search('E2E Updated Payment');
        await expect(lp.getRows().filter({ hasText: 'E2E Updated Payment' }).first()).toBeVisible();
    });

    test('should bulk-delete the test payment method', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await lp.search('E2E Updated Payment');

        await lp.bulkDelete('all');
        await lp.expectSuccessToast();
    });
});
