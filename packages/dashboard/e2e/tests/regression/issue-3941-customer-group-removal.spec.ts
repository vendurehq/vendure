import { type Page, expect, test } from '@playwright/test';

import { BaseDetailPage } from '../../page-objects/detail-page.base.js';
import { BaseListPage } from '../../page-objects/list-page.base.js';

// Regression: https://github.com/vendurehq/vendure/issues/3941
// Fix PR: https://github.com/vendurehq/vendure/pull/4346
//
// The customer group detail page has no bulk action to remove customers from a group.
// Selecting customers and clicking "With selected" shows an empty action popup.

test.describe('Issue #3941: Customer group member removal', () => {
    test.describe.configure({ mode: 'serial' });

    const listPage = (page: Page) =>
        new BaseListPage(page, {
            path: '/customer-groups',
            title: 'Customer Groups',
            newButtonLabel: 'New Customer Group',
        });

    const detailPage = (page: Page) =>
        new BaseDetailPage(page, {
            newPath: '/customer-groups/new',
            pathPrefix: '/customer-groups/',
            newTitle: 'New customer group',
        });

    let groupCreated = false;

    test('should create a customer group and add a member', async ({ page }) => {
        // Create a group
        const dp = detailPage(page);
        await dp.gotoNew();
        await dp.expectNewPageLoaded();
        await dp.fillInput('Name', 'E2E Removal Test Group');
        await dp.clickCreate();
        await dp.expectSuccessToast(/Successfully created customer group/);
        await dp.expectNavigatedToExisting();
        groupCreated = true;

        // Add a customer to the group
        await page.getByRole('button', { name: /Add customer/i }).click();
        await page.getByPlaceholder('Search customers...').fill('e');
        await expect(page.getByRole('option').first()).toBeVisible({ timeout: 5_000 });
        await page.getByRole('option').first().click();
        await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);

        // Verify customer appears in the members table
        const membersTable = page.getByRole('table').last();
        await expect(membersTable.getByRole('row')).toHaveCount(2, { timeout: 5_000 }); // header + 1 member
    });

    test.fixme('should show "Remove from group" bulk action when members are selected', async ({ page }) => {
        test.skip(!groupCreated, 'Group was not created in previous test');

        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await lp.clickEntity('E2E Removal Test Group');
        await expect(page).toHaveURL(/\/customer-groups\/[^/]+$/);

        // Select the first member's checkbox in the members table
        const membersTable = page.getByRole('table').last();
        await membersTable.getByRole('checkbox').first().click();

        // Click "With selected" and expect "Remove from group" action
        await page.getByRole('button', { name: /Actions/i }).click();
        await expect(page.getByRole('menuitem').filter({ hasText: /Remove from group/i })).toBeVisible();
    });

    test('should clean up the test customer group', async ({ page }) => {
        test.skip(!groupCreated, 'Group was not created');

        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();

        const row = lp.getRows().filter({ hasText: 'E2E Removal Test Group' });
        await row.getByRole('checkbox').click();
        await page.getByRole('button', { name: /Actions/i }).click();
        await page.locator('[role="menu"]').getByText('Delete', { exact: true }).click();
        await page.locator('[role="alertdialog"]').getByRole('button', { name: 'Continue' }).click();
        await lp.expectSuccessToast();
    });
});
