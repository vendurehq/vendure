import { expect, test } from '@playwright/test';

// Global Settings is a single detail page (not a list) with:
// - Available languages (LanguageSelector)
// - Global out of stock threshold (NumberInput)
// - Track inventory by default (Switch)

test.describe('Global Settings', () => {
    test('should display the global settings page', async ({ page }) => {
        await page.goto('/global-settings');
        await expect(page.getByTestId('page-heading')).toBeVisible({
            timeout: 10_000,
        });
    });

    test('should show the settings form fields', async ({ page }) => {
        await page.goto('/global-settings');
        await expect(page.getByTestId('page-heading')).toBeVisible({
            timeout: 10_000,
        });
        await expect(page.getByText('Available languages')).toBeVisible();
        await expect(page.getByText('Global out of stock threshold')).toBeVisible();
        await expect(page.getByText('Track inventory by default')).toBeVisible();
    });

    test('should have an Update button', async ({ page }) => {
        await page.goto('/global-settings');
        await expect(page.getByTestId('page-heading')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole('button', { name: 'Update' })).toBeVisible();
    });

    test('should update out of stock threshold and persist', async ({ page }) => {
        await page.goto('/global-settings');
        await expect(page.getByTestId('page-heading')).toBeVisible({
            timeout: 10_000,
        });

        // Find the threshold input via its label
        const thresholdField = page.locator('[data-slot="field"]').filter({
            has: page
                .locator('[data-slot="field-label"]')
                .getByText('Global out of stock threshold', { exact: true }),
        });
        const thresholdInput = thresholdField.getByRole('spinbutton');
        await expect(thresholdInput).toBeVisible();

        // Store original value
        const originalValue = await thresholdInput.inputValue();

        // Set a new value
        const newValue = originalValue === '-5' ? '-10' : '-5';
        await thresholdInput.fill(newValue);

        // Click Update
        await page.getByRole('button', { name: 'Update' }).click();
        await expect(
            page.locator('[data-sonner-toast]').filter({ hasNotText: /error/i }).first(),
        ).toBeVisible({ timeout: 10_000 });

        // Reload and verify persistence
        await page.reload();
        await expect(page.getByTestId('page-heading')).toBeVisible({
            timeout: 10_000,
        });

        const reloadedField = page.locator('[data-slot="field"]').filter({
            has: page
                .locator('[data-slot="field-label"]')
                .getByText('Global out of stock threshold', { exact: true }),
        });
        await expect(reloadedField.getByRole('spinbutton')).toHaveValue(newValue, { timeout: 10_000 });

        // Reset to original value
        await reloadedField.getByRole('spinbutton').fill(originalValue);
        await page.getByRole('button', { name: 'Update' }).click();
        await expect(
            page.locator('[data-sonner-toast]').filter({ hasNotText: /error/i }).first(),
        ).toBeVisible({ timeout: 10_000 });
    });

    test('should toggle track inventory and persist', async ({ page }) => {
        await page.goto('/global-settings');
        await expect(page.getByTestId('page-heading')).toBeVisible({
            timeout: 10_000,
        });
        // Wait for form data to fully load: Update button disabled = form is clean with server data
        await page.waitForLoadState('networkidle');
        await expect(page.getByRole('button', { name: 'Update' })).toBeDisabled({ timeout: 10_000 });

        // Find the track inventory switch via its label
        const trackField = page.locator('[data-slot="field"]').filter({
            has: page
                .locator('[data-slot="field-label"]')
                .getByText('Track inventory by default', { exact: true }),
        });
        const trackSwitch = trackField.getByRole('switch');
        await expect(trackSwitch).toBeVisible();

        // Store original state
        const wasChecked = await trackSwitch.isChecked();

        // Toggle the switch
        await trackSwitch.click();

        // Click Update
        await page.getByRole('button', { name: 'Update' }).click();
        await expect(
            page.locator('[data-sonner-toast]').filter({ hasNotText: /error/i }).first(),
        ).toBeVisible({ timeout: 10_000 });

        // Reload and verify persistence
        await page.reload();
        await expect(page.getByTestId('page-heading')).toBeVisible({
            timeout: 10_000,
        });
        await page.waitForLoadState('networkidle');
        await expect(page.getByRole('button', { name: 'Update' })).toBeDisabled({ timeout: 10_000 });

        const reloadedField = page.locator('[data-slot="field"]').filter({
            has: page
                .locator('[data-slot="field-label"]')
                .getByText('Track inventory by default', { exact: true }),
        });
        const reloadedSwitch = reloadedField.getByRole('switch');
        if (wasChecked) {
            await expect(reloadedSwitch).not.toBeChecked();
        } else {
            await expect(reloadedSwitch).toBeChecked();
        }

        // Reset to original state
        await reloadedSwitch.click();
        await page.getByRole('button', { name: 'Update' }).click();
        await expect(
            page.locator('[data-sonner-toast]').filter({ hasNotText: /error/i }).first(),
        ).toBeVisible({ timeout: 10_000 });
    });
});
