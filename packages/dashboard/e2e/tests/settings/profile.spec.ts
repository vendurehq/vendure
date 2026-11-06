import { expect, test } from '@playwright/test';
import path from 'node:path';

import { VendureAdminClient } from '../../utils/vendure-admin-client.js';

test.describe('Profile', () => {
    test('should display profile page with form fields', async ({ page }) => {
        await page.goto('/profile');

        await expect(page.getByTestId('page-heading')).toBeVisible();

        // Verify form fields are present
        await expect(page.getByText('First name')).toBeVisible();
        await expect(page.getByText('Last name')).toBeVisible();
        await expect(page.getByText('Email Address or identifier')).toBeVisible();
        // "Password" appears as both a field label and an auth method badge,
        // so scope to the field label to avoid strict mode violation
        await expect(page.locator('[data-slot="field-label"]').getByText('Password')).toBeVisible();

        // Verify Update button is present
        await expect(page.getByRole('button', { name: 'Update' })).toBeVisible();
    });

    test('should update first name and persist', async ({ page }) => {
        await page.goto('/profile');
        await expect(page.getByTestId('page-heading')).toBeVisible();

        // Find the first name input via field label
        const firstNameField = page.locator('[data-slot="field"]').filter({
            has: page.locator('[data-slot="field-label"]').getByText('First name', { exact: true }),
        });
        const firstNameInput = firstNameField.getByRole('textbox');
        await expect(firstNameInput).toBeVisible();

        // Store original value
        const originalValue = await firstNameInput.inputValue();

        // Set a new value
        const newValue = originalValue === 'TestFirstName' ? 'Super' : 'TestFirstName';
        await firstNameInput.fill(newValue);

        // Click Update
        await page.getByRole('button', { name: 'Update' }).click();
        await expect(
            page
                .locator('[data-sonner-toast]')
                .filter({ hasText: /updated/i })
                .first(),
        ).toBeVisible({ timeout: 10_000 });

        // Reload and verify persistence
        await page.reload();
        await expect(page.getByTestId('page-heading')).toBeVisible();

        const reloadedField = page.locator('[data-slot="field"]').filter({
            has: page.locator('[data-slot="field-label"]').getByText('First name', { exact: true }),
        });
        await expect(reloadedField.getByRole('textbox')).toHaveValue(newValue);

        // Reset to original value
        await reloadedField.getByRole('textbox').fill(originalValue);
        await page.getByRole('button', { name: 'Update' }).click();
        await expect(
            page
                .locator('[data-sonner-toast]')
                .filter({ hasText: /updated/i })
                .first(),
        ).toBeVisible({ timeout: 10_000 });
    });

    test('should show Update button disabled when no changes', async ({ page }) => {
        await page.goto('/profile');
        await expect(page.getByTestId('page-heading')).toBeVisible();

        // The Update button should be disabled when no changes have been made
        const updateButton = page.getByRole('button', { name: 'Update' });
        await expect(updateButton).toBeDisabled();

        // Make a change to enable the button
        const firstNameField = page.locator('[data-slot="field"]').filter({
            has: page.locator('[data-slot="field-label"]').getByText('First name', { exact: true }),
        });
        const firstNameInput = firstNameField.getByRole('textbox');
        const originalValue = await firstNameInput.inputValue();
        await firstNameInput.fill(originalValue + 'x');

        // Button should now be enabled
        await expect(updateButton).toBeEnabled();

        // Reset to original value (don't submit)
        await firstNameInput.fill(originalValue);
    });

    test('should upload, replace and remove the profile picture in the sidebar', async ({ page }) => {
        await page.route('http://test-asset.local/**', async route => {
            await route.fulfill({
                contentType: 'image/jpeg',
                path: path.resolve('../core/e2e/fixtures/assets/pps1.jpg'),
            });
        });
        await page.goto('/profile');
        await expect(page.getByText('Profile picture')).toBeVisible();
        const input = page.locator('#administrator-avatar-upload');
        const sidebarAvatar = page.locator('[data-slot="sidebar"] [data-slot="avatar-image"]');

        await input.setInputFiles(path.resolve('../core/e2e/fixtures/assets/pps1.jpg'));
        await expect(sidebarAvatar).toHaveAttribute('src', /pps1/);

        await input.setInputFiles(path.resolve('../core/e2e/fixtures/assets/pps2.jpg'));
        await expect(sidebarAvatar).toHaveAttribute('src', /pps2/);

        await page.getByRole('button', { name: 'Remove' }).click();
        await expect(sidebarAvatar).toHaveCount(0);
    });

    // #5037 — an admin without UpdateAdministrator permission must still be able to
    // edit their own profile (the page uses updateActiveAdministrator, gated by Owner)
    test('should allow an admin without UpdateAdministrator permission to update own profile', async ({
        page,
        browser,
    }) => {
        const suffix = Date.now();
        const emailAddress = `restricted-${suffix}@test.com`;
        const password = 'test-password';

        const client = new VendureAdminClient(page);
        await client.login();
        const { createRole } = await client.gql(
            `mutation ($input: CreateRoleInput!) { createRole(input: $input) { id } }`,
            {
                input: {
                    code: `restricted-${suffix}`,
                    description: 'No admin permissions',
                    permissions: ['ReadCatalog'],
                },
            },
        );
        await client.gql(
            `mutation ($input: CreateAdministratorInput!) { createAdministrator(input: $input) { id } }`,
            {
                input: {
                    firstName: 'Restricted',
                    lastName: 'Admin',
                    emailAddress,
                    password,
                    roleIds: [createRole.id],
                },
            },
        );

        // Fresh context so we browse as the restricted admin, not the superadmin
        const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
        const restrictedPage = await context.newPage();
        await restrictedPage.goto('/login');
        await restrictedPage.getByPlaceholder('Email').fill(emailAddress);
        await restrictedPage.getByPlaceholder('Password').fill(password);
        await restrictedPage.getByRole('button', { name: 'Sign in' }).click();
        await expect(restrictedPage).not.toHaveURL(/\/login/, { timeout: 15_000 });

        await restrictedPage.goto('/profile');
        const firstNameField = restrictedPage.locator('[data-slot="field"]').filter({
            has: restrictedPage.locator('[data-slot="field-label"]').getByText('First name', { exact: true }),
        });
        await firstNameField.getByRole('textbox').fill('Renamed');
        await restrictedPage.getByRole('button', { name: 'Update' }).click();

        await expect(
            restrictedPage.locator('[data-sonner-toast]').filter({ hasText: 'Successfully updated profile' }),
        ).toBeVisible({ timeout: 10_000 });

        await restrictedPage.reload();
        await expect(firstNameField.getByRole('textbox')).toHaveValue('Renamed');

        await context.close();
    });
});
