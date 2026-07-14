import { type Page, expect, test } from '@playwright/test';

import { BaseDetailPage } from '../../page-objects/detail-page.base.js';
import { BaseListPage } from '../../page-objects/list-page.base.js';

// Channels have dependent selectors: available languages/currencies must be set
// before their respective defaults. Zone selectors are standard Base UI Selects.

test.describe('Channels CRUD', () => {
    test.describe.configure({ mode: 'serial' });

    const listPage = (page: Page) =>
        new BaseListPage(page, {
            path: '/channels',
            title: 'Channels',
            newButtonLabel: 'New Channel',
        });

    const detailPage = (page: Page) =>
        new BaseDetailPage(page, {
            newPath: '/channels/new',
            pathPrefix: '/channels/',
            newTitle: 'New channel',
        });

    test('should display the channels list page', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
    });

    test('should show the default channel', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        // ChannelCodeLabel renders the default channel code as "Default channel"
        await expect(lp.getRows().filter({ hasText: 'Default channel' }).first()).toBeVisible();
    });

    test('should navigate to channel detail', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await lp.clickEntity('Default channel');
        await expect(page).toHaveURL(/\/channels\/[^/]+$/);
    });

    test('should create a new channel', async ({ page }) => {
        const dp = detailPage(page);
        await dp.gotoNew();
        await dp.expectNewPageLoaded();

        await dp.fillInput('Code', 'e2e-test-channel');
        await dp.fillInput('Token', 'e2e-test-token');

        // Available languages — MultiSelect popover (few items, no search input)
        await dp.formItem('Available languages').getByRole('combobox').click();
        // Popover renders options as plain <button> inside [data-slot="popover-content"]
        await page
            .locator('[data-slot="popover-content"]')
            .getByRole('button', { name: /English/ })
            .click();
        // Click outside to close the popover and let form state propagate
        await page.locator('body').click({ position: { x: 0, y: 0 } });
        await expect(page.locator('[data-slot="popover-content"]')).not.toBeVisible();

        // Default language — single-select filtered by available languages
        await dp.formItem('Default language').getByRole('combobox').click();
        await page
            .locator('[data-slot="popover-content"]')
            .getByRole('button', { name: /English/ })
            .click();

        // Available currencies — MultiSelect popover (100+ items, search shows)
        await dp.formItem('Available currencies').getByRole('combobox').click();
        await page
            .locator('[data-slot="popover-content"]')
            .getByPlaceholder('Search currencies...')
            .fill('Dollar');
        await page
            .locator('[data-slot="popover-content"]')
            .getByRole('button', { name: /Dollar/ })
            .first()
            .click();
        await page.locator('body').click({ position: { x: 0, y: 0 } });
        await expect(page.locator('[data-slot="popover-content"]')).not.toBeVisible();

        // Default currency — single-select filtered by available currencies
        await dp.formItem('Default currency').getByRole('combobox').click();
        await page
            .locator('[data-slot="popover-content"]')
            .getByRole('button', { name: /Dollar/ })
            .click();

        // Default tax zone — Base UI Select
        await dp.selectOption('Default tax zone', 'Europe');

        // Default shipping zone — Base UI Select
        await dp.selectOption('Default shipping zone', 'Europe');

        await dp.clickCreate();
        await dp.expectSuccessToast(/Successfully created channel/);
        await dp.expectNavigatedToExisting();
    });

    test('should find the created channel in the list', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await expect(lp.getRows().filter({ hasText: 'e2e-test-channel' }).first()).toBeVisible();
    });

    test('should navigate to created channel detail page', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await lp.clickEntity('e2e-test-channel');
        await expect(page).toHaveURL(/\/channels\/[^/]+$/);
    });

    test('should update the channel', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await lp.clickEntity('e2e-test-channel');
        await expect(page).toHaveURL(/\/channels\/[^/]+$/);

        const dp = detailPage(page);
        await dp.fillInput('Token', 'e2e-updated-token');
        await dp.clickUpdate();
        await dp.expectSuccessToast(/Successfully updated channel/);
    });

    test('should show updated channel in the list', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await expect(lp.getRows().filter({ hasText: 'e2e-test-channel' }).first()).toBeVisible();
    });

    test('should bulk-delete the test channel', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();

        const testChannelRow = lp.getRows().filter({ hasText: 'e2e-test-channel' });
        await testChannelRow.getByRole('checkbox').click();
        await page.getByRole('button', { name: /Actions/i }).click();
        await page.locator('[role="menu"]').getByText('Delete', { exact: true }).click();
        await page.locator('[role="alertdialog"]').getByRole('button', { name: 'Continue' }).click();
        await lp.expectSuccessToast();

        await expect(lp.getRows().filter({ hasText: 'e2e-test-channel' })).toHaveCount(0);
    });
});
