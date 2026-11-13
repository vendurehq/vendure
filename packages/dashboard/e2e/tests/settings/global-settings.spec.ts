import { expect, test } from '@playwright/test';

// Global Settings is a single detail page (not a list) with:
// - Available languages (LanguageSelector)
// - Global out of stock threshold (NumberInput)

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
        // #2908 — the inventory tracking default moved to the Channel (see channels.spec.ts)
        await expect(page.getByText('Track inventory by default')).toHaveCount(0);
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
});
