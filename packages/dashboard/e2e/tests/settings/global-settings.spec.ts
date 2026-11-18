import { expect, test } from '@playwright/test';

// Global Settings is a single detail page (not a list) with:
// - Available languages (LanguageSelector)

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
        // #2908 — the inventory tracking default moved to the Channel (see channels.spec.ts)
        await expect(page.getByText('Track inventory by default')).toHaveCount(0);
        // OSS-1299 — so did the out-of-stock threshold
        await expect(page.getByText(/out of stock threshold/i)).toHaveCount(0);
    });

    test('should have an Update button', async ({ page }) => {
        await page.goto('/global-settings');
        await expect(page.getByTestId('page-heading')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole('button', { name: 'Update' })).toBeVisible();
    });
});
