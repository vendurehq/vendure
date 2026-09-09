import { type Page, expect, test } from '@playwright/test';

import { LS_KEY_SHIPPING_TEST_ADDRESS } from '../../../src/lib/storage-keys.js';
import { BaseDetailPage } from '../../page-objects/detail-page.base.js';
import { BaseListPage } from '../../page-objects/list-page.base.js';

// Shipping Methods require ConfigurableOperation selectors (checker + calculator)
// and a fulfillment handler Select, so they don't fit the standard CRUD factory.

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

async function openShippingTestCountrySelect(page: Page) {
    const lp = listPage(page);
    await lp.goto();
    await lp.expectLoaded();
    await lp.search('Standard Shipping');
    await lp.clickEntity('Standard Shipping');
    await page.getByRole('button', { name: 'Test' }).click();

    const testSheet = page.getByRole('dialog', { name: 'Test Shipping Method' });
    return testSheet.locator('[data-slot="field"]').filter({ hasText: 'Country' }).getByRole('combobox');
}

test.describe('Shipping Methods CRUD', () => {
    test.describe.configure({ mode: 'serial' });

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

test.describe('Shipping method test address', () => {
    test.describe.configure({ mode: 'serial' });

    // #5191 — an empty country field must display its placeholder
    test('should display the country placeholder when no country is selected', async ({ page }) => {
        await page.addInitScript(
            storageKey => localStorage.removeItem(storageKey),
            LS_KEY_SHIPPING_TEST_ADDRESS,
        );

        const countrySelect = await openShippingTestCountrySelect(page);

        await expect(countrySelect).toContainText('Select a country');
    });

    // #5191 — saved address countries must display in the shipping test address form
    test('should display the saved country in the test address form', async ({ page }) => {
        await page.addInitScript(
            ({ storageKey, address }) => {
                localStorage.setItem(storageKey, JSON.stringify(address));
            },
            {
                storageKey: LS_KEY_SHIPPING_TEST_ADDRESS,
                address: {
                    fullName: 'Test Customer',
                    streetLine1: '123 Main Street',
                    city: 'New York',
                    province: 'NY',
                    postalCode: '10001',
                    countryCode: 'US',
                },
            },
        );

        const countrySelect = await openShippingTestCountrySelect(page);

        await expect(countrySelect).toContainText('United States of America');
    });
});
