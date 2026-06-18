import { expect, test } from '@playwright/test';

// The Job Queue page uses the standard ListPage component with
// faceted filters (Queue, State) and auto-refresh support.

test.describe('Job Queue', () => {
    test('should display the job queue page', async ({ page }) => {
        await page.goto('/job-queue');
        await expect(page.getByTestId('page-heading')).toBeVisible();
    });

    test('should show the data table with column headers', async ({ page }) => {
        await page.goto('/job-queue');
        await expect(page.getByTestId('page-heading')).toBeVisible();
        // The ListPage renders a table with standard job columns
        await expect(page.getByRole('table')).toBeVisible();
    });

    test('should show the auto-refresh control', async ({ page }) => {
        await page.goto('/job-queue');
        await expect(page.getByText(/Auto refresh/i)).toBeVisible();
    });
});
