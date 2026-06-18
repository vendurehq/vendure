import { expect, test } from '@playwright/test';

// Assets use a gallery (grid) layout rather than a standard data table.
// The AssetGallery component displays images in a grid with pagination.
// Test data has no asset-server-plugin, so the gallery starts empty.

test.describe('Assets', () => {
    test('should display the assets page', async ({ page }) => {
        await page.goto('/assets');
        await expect(page.getByTestId('page-heading')).toBeVisible();
    });

    test('should show upload button and search', async ({ page }) => {
        await page.goto('/assets');
        await expect(page.getByTestId('page-heading')).toBeVisible();
        await expect(page.getByRole('button', { name: /Upload/i })).toBeVisible();
        await expect(page.getByPlaceholder(/Search assets/i)).toBeVisible();
    });
});
