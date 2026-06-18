import { expect, test } from '@playwright/test';

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
});
