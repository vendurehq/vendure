import { expect, test } from '@playwright/test';

// Scheduled Tasks page displays a DataTable of registered scheduled tasks
// with their schedule, execution status, and action controls.

test.describe('Scheduled Tasks', () => {
    test('should display the scheduled tasks page', async ({ page }) => {
        await page.goto('/scheduled-tasks');
        await expect(page.getByTestId('page-heading')).toBeVisible();
    });

    test('should show the data table', async ({ page }) => {
        await page.goto('/scheduled-tasks');
        await expect(page.getByTestId('page-heading')).toBeVisible();
        await expect(page.getByRole('table')).toBeVisible();
    });

    // OSS-470 — column visibility must survive a refresh.
    //
    // Original bug: the parent's inline `defaultColumnVisibility` got a new
    // reference each render, and the DataTable effect compared that against
    // the user-modified state and reset it. The user-visible trigger was the
    // disable/enable mutation's onSuccess → queryClient.invalidateQueries →
    // parent re-render. This e2e Vendure config registers no scheduled tasks,
    // so refetches return the same empty data and TanStack Query's tracked
    // properties skip the parent re-render — meaning this test does not fail
    // against the unfixed code. It is kept as a smoke test for the wider class
    // of "resets-on-refresh" regressions; the actual fix was verified manually
    // on a dev server with real scheduled tasks.
    test('should preserve column visibility after a refresh', async ({ page }) => {
        await page.goto('/scheduled-tasks');
        await expect(page.getByRole('table')).toBeVisible();

        const dataTable = page.getByRole('table');
        const descriptionHeader = dataTable.locator('thead th').filter({ hasText: 'Description' });

        // "Description" column is visible by default — hide it via column settings.
        await expect(descriptionHeader).toBeVisible();
        await page.getByTestId('dt-column-settings-trigger').click();
        await page.getByRole('menuitemcheckbox', { name: 'Description', exact: true }).click();
        await page.keyboard.press('Escape');
        await expect(descriptionHeader).toBeHidden();

        // Refresh — same code path the disable/enable mutation onSuccess takes.
        await page.getByTestId('dt-refresh-button').click();

        // Column visibility must persist across the refetch.
        await expect(descriptionHeader).toBeHidden();
    });
});
