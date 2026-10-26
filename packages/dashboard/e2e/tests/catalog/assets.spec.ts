import { expect, test } from '@playwright/test';

// Assets support both a gallery grid and a standard data table list view.
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

    // #4992 — grid-view bulk actions: selecting assets swaps the search bar
    // for the bulk bar; clearing the selection (unselect / reset) swaps the
    // search bar back in, and the view toggle keeps working while a selection
    // exists.
    test('should swap search for bulk bar on grid selection and clear it again', async ({ page }) => {
        await page.goto('/assets');
        await expect(page.getByTestId('page-heading')).toBeVisible();

        // The gallery may start empty — upload a tiny PNG through the dropzone
        // input. The name is unique per run so the checkbox locator can't hit a
        // different card while the upload refetch is still in flight.
        const fileName = `grid-selection-${Date.now()}.png`;
        const tinyPng = Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
            'base64',
        );
        await page
            .locator('input[type="file"]')
            .setInputFiles({ name: fileName, mimeType: 'image/png', buffer: tinyPng });

        const checkbox = page.getByRole('checkbox', { name: `Toggle selection for ${fileName}` });
        await expect(checkbox).toBeVisible({ timeout: 15_000 });
        const bulkBar = page.getByRole('toolbar', { name: /Bulk actions/i });
        const searchInput = page.getByPlaceholder(/Search assets/i);

        // Select: the bulk bar takes the search bar's place.
        await checkbox.click();
        await expect(bulkBar).toBeVisible();
        await expect(searchInput).not.toBeVisible();

        // Unselect the same asset: the search bar comes back.
        await checkbox.click();
        await expect(bulkBar).not.toBeVisible();
        await expect(searchInput).toBeVisible();

        // Reset selection clears it too.
        await checkbox.click();
        await expect(bulkBar).toBeVisible();
        await bulkBar.getByRole('button', { name: /Reset selection/i }).click();
        await expect(bulkBar).not.toBeVisible();
        await expect(searchInput).toBeVisible();

        // Switching views works while a selection exists.
        await checkbox.click();
        await expect(bulkBar).toBeVisible();
        await page.getByLabel(/List view/i).click();
        await expect(page.getByRole('table')).toBeVisible();
    });
});
