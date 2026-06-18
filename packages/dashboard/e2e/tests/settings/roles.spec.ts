import { type Page, expect, test } from '@playwright/test';

import { BaseDetailPage } from '../../page-objects/detail-page.base.js';
import { BaseListPage } from '../../page-objects/list-page.base.js';

// Roles have a permissions grid and channel multi-select that don't fit
// the standard CRUD factory. System roles (SuperAdmin, Customer) have
// disabled detail links and cannot be edited.

test.describe('Roles', () => {
    test.describe.configure({ mode: 'serial' });

    const listPage = (page: Page) =>
        new BaseListPage(page, {
            path: '/roles',
            title: 'Roles',
            newButtonLabel: 'New Role',
        });

    const detailPage = (page: Page) =>
        new BaseDetailPage(page, {
            newPath: '/roles/new',
            pathPrefix: '/roles/',
            newTitle: 'New role',
        });

    test('should display the roles list page', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
    });

    test('should show built-in roles', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        // RoleCodeLabel renders __super_admin_role__ as "Super Admin"
        await expect(lp.getRows().filter({ hasText: 'Super Admin' }).first()).toBeVisible();
    });

    test('should create a new role', async ({ page }) => {
        const dp = detailPage(page);
        await dp.gotoNew();
        await dp.expectNewPageLoaded();

        await dp.fillInput('Description', 'E2E Test Role');
        await dp.fillInput('Code', 'e2e-test-role');

        // Select the default channel via the Channels multi-select
        const channelsCombobox = dp.formItem('Channels').getByRole('combobox');
        await dp.selectPopoverOption(channelsCombobox, 'Default channel');

        // Toggle at least one permission group — find the first "Toggle all" button
        // in the permissions grid and click it to enable that group
        const permissionsGrid = dp.formItem('Permissions');
        await permissionsGrid.getByRole('button', { name: 'Toggle all' }).first().click();

        await dp.clickCreate();
        await dp.expectSuccessToast(/Successfully created role/);
        await dp.expectNavigatedToExisting();
    });

    test('should find the created role in the list', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await expect(lp.getRows().filter({ hasText: 'E2E Test Role' }).first()).toBeVisible();
    });

    test('should navigate to role detail page', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        // Custom roles use the code as the link text via RoleCodeLabel
        await lp.clickEntity('e2e-test-role');
        await expect(page).toHaveURL(/\/roles\/[^/]+$/);
    });

    test('should update the role', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await lp.clickEntity('e2e-test-role');
        await expect(page).toHaveURL(/\/roles\/[^/]+$/);

        const dp = detailPage(page);
        await dp.fillInput('Description', 'E2E Updated Role');
        await dp.clickUpdate();
        await dp.expectSuccessToast(/Successfully updated role/);
    });

    test('should show updated role in the list', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await expect(lp.getRows().filter({ hasText: 'E2E Updated Role' }).first()).toBeVisible();
    });

    test('should bulk-delete the test role', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();

        const testRoleRow = lp.getRows().filter({ hasText: 'E2E Updated Role' });
        await testRoleRow.getByRole('checkbox').click();
        await page.getByRole('button', { name: /Actions/i }).click();
        await page.locator('[role="menu"]').getByText('Delete', { exact: true }).click();
        await page.locator('[role="alertdialog"]').getByRole('button', { name: 'Continue' }).click();
        await lp.expectSuccessToast();

        await expect(lp.getRows().filter({ hasText: 'E2E Updated Role' })).toHaveCount(0);
    });
});
