import { type Page, expect, test } from '@playwright/test';

import { BaseDetailPage } from '../../page-objects/detail-page.base.js';
import { BaseListPage } from '../../page-objects/list-page.base.js';

// Shipping Methods require ConfigurableOperation selectors (checker + calculator)
// and a fulfillment handler Select, so they don't fit the standard CRUD factory.

test.describe('Shipping Methods CRUD', () => {
    test.describe.configure({ mode: 'serial' });

    const listPage = (page: Page) =>
        new BaseListPage(page, {
            path: '/shipping-methods',
            title: 'Shipping Methods',
            newButtonLabel: 'New Shipping Method',
        });

    const detailPage = (page: Page) =>
        new BaseDetailPage(page, {
            newPath: '/shipping-methods/new',
            pathPrefix: '/shipping-methods/',
            newTitle: 'New shipping method',
        });

    test('should display the shipping methods list page', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
    });

    test('should show existing shipping methods', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        // Seed data includes Standard Shipping and Express Shipping
        await lp.expectRowCountGreaterThan(0);
    });

    test('should create a new shipping method', async ({ page }) => {
        const dp = detailPage(page);
        await dp.gotoNew();
        await dp.expectNewPageLoaded();

        await dp.fillInput('Name', 'E2E Test Shipping');
        await dp.fillInput('Code', 'e2e-test-shipping');

        // Fulfillment handler — standard Select
        await dp.selectOption('Fulfillment handler', 'Manually enter fulfillment details');

        // Shipping Eligibility Checker — ConfigurableOperationSelector (DropdownMenu)
        await page.getByRole('button', { name: 'Select Shipping Eligibility Checker' }).click();
        await page.getByRole('menuitem', { name: 'Default Shipping Eligibility Checker' }).click();

        // Shipping Calculator — ConfigurableOperationSelector (DropdownMenu)
        await page.getByRole('button', { name: 'Select Shipping Calculator' }).click();
        await page.getByRole('menuitem', { name: /Flat-Rate Shipping Calculator/ }).click();

        await dp.clickCreate();
        await dp.expectSuccessToast(/Successfully created shipping method/);
        await dp.expectNavigatedToExisting();
    });

    test('should find the created shipping method via search', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await lp.search('E2E Test Shipping');
        await expect(lp.getRows().filter({ hasText: 'E2E Test Shipping' }).first()).toBeVisible();
    });

    test('should navigate to shipping method detail page', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await lp.search('E2E Test Shipping');
        await lp.clickEntity('E2E Test Shipping');
        await expect(page).toHaveURL(/\/shipping-methods\/[^/]+$/);
    });

    test('should update the shipping method', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await lp.search('E2E Test Shipping');
        await lp.clickEntity('E2E Test Shipping');
        await expect(page).toHaveURL(/\/shipping-methods\/[^/]+$/);

        const dp = detailPage(page);
        await dp.fillInput('Name', 'E2E Updated Shipping');
        await dp.clickUpdate();
        await dp.expectSuccessToast(/Successfully updated shipping method/);
    });

    test('should show updated shipping method in the list', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await lp.search('E2E Updated Shipping');
        await expect(lp.getRows().filter({ hasText: 'E2E Updated Shipping' }).first()).toBeVisible();
    });

    test('should bulk-delete the test shipping method', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await lp.search('E2E Updated Shipping');

        await lp.bulkDelete('all');
        await lp.expectSuccessToast();
    });
});
