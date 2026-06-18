import { expect, test } from '@playwright/test';

test.describe('Dashboard Insights', () => {
    test('should display the insights page', async ({ page }) => {
        await page.goto('/');

        await expect(page.getByTestId('page-heading')).toBeVisible();
    });

    test('should display the date range picker', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByTestId('page-heading')).toBeVisible();

        // The DateRangePicker is a Button showing "Mar 1, 2026 - Mar 20, 2026"
        const dateRangePicker = page.getByRole('button', {
            name: /\w{3} \d{1,2}, \d{4}\s*-\s*\w{3} \d{1,2}, \d{4}/,
        });
        await expect(dateRangePicker).toBeVisible();
    });

    test('should toggle edit layout mode', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByTestId('page-heading')).toBeVisible();

        // Click "Edit Layout" button
        const editButton = page.getByRole('button', { name: 'Edit Layout' });
        await expect(editButton).toBeVisible();
        await editButton.click();

        // Button should change to "Save Layout"
        await expect(page.getByRole('button', { name: 'Save Layout' })).toBeVisible();

        // Click "Save Layout" to exit edit mode
        await page.getByRole('button', { name: 'Save Layout' }).click();

        // Button should return to "Edit Layout"
        await expect(page.getByRole('button', { name: 'Edit Layout' })).toBeVisible();
    });
});
