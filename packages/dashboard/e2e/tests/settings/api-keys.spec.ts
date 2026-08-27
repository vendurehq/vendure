import { type Page, expect, test } from '@playwright/test';

import { BaseDetailPage } from '../../page-objects/detail-page.base.js';
import { BaseListPage } from '../../page-objects/list-page.base.js';

// API keys have a role assignment builder and a one-time secret dialog on create,
// so they don't fit the standard CRUD factory.

test.describe('API keys', () => {
    test.describe.configure({ mode: 'serial' });

    const API_KEY_NAME = 'e2e-test-api-key';

    const listPage = (page: Page) =>
        new BaseListPage(page, {
            path: '/api-keys',
            title: 'API Keys',
            newButtonLabel: 'New API Key',
        });

    const detailPage = (page: Page) =>
        new BaseDetailPage(page, {
            newPath: '/api-keys/new',
            pathPrefix: '/api-keys/',
            newTitle: 'New API Key',
        });

    test('should display the API keys list page', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
    });

    // OSS-300 — API keys are granted roles per channel via roleAssignments
    test('should create an API key with a role on the active channel', async ({ page }) => {
        const dp = detailPage(page);
        await dp.gotoNew();
        await dp.expectNewPageLoaded();

        await dp.fillInput('Name', API_KEY_NAME);

        // The role assignment editor starts with one row on the active channel,
        // so only the role itself needs picking
        const roleCombobox = page.getByRole('combobox').first();
        await dp.selectPopoverOption(roleCombobox, 'SuperAdmin');

        await dp.clickCreate();
        await dp.expectSuccessToast(/Successfully created API key/);

        // The secret is only shown once, behind an explicit acknowledgement
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByText('Your API Key')).toBeVisible();
        await dialog.getByRole('checkbox').click();
        // The dialog's built-in X is also named "Close", so target the footer button's slot
        await dialog.locator('button[data-slot="button"]', { hasText: 'Close' }).click();
    });

    // OSS-300 — the saved (roleId, channelId) pair must load back into the editor
    test('should show the assigned role when reopening the API key', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await lp.clickEntity(API_KEY_NAME);
        await expect(page).toHaveURL(/\/api-keys\/[^/]+$/);

        await expect(page.getByRole('combobox').first()).toContainText('SuperAdmin');
    });
});
