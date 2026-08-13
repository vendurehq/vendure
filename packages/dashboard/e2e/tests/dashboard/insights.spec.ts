import { expect, test } from '@playwright/test';

test.describe('Dashboard Insights', () => {
    test('should display the insights page', async ({ page }) => {
        await page.goto('/');

        await expect(page.getByTestId('page-heading')).toBeVisible();
    });

    test('should display the date range picker', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByTestId('page-heading')).toBeVisible();

        const dateRangePicker = page.locator('[data-slot="date-range-picker"]').getByRole('button');
        await expect(dateRangePicker).toBeVisible();
    });

    test('should toggle edit layout mode', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByTestId('page-heading')).toBeVisible();

        // Click the icon-only "Edit layout" button
        const editButton = page.getByRole('button', { name: 'Edit layout' });
        await expect(editButton).toBeVisible();
        await editButton.click();

        // Button should change to "Save Layout"
        await expect(page.getByRole('button', { name: 'Save Layout' })).toBeVisible();

        // Click "Save Layout" to exit edit mode
        await page.getByRole('button', { name: 'Save Layout' }).click();

        // Button should return to the "Edit layout" icon button
        await expect(page.getByRole('button', { name: 'Edit layout' })).toBeVisible();
    });
});
