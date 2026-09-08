import { expect, test } from '@playwright/test';

test.describe('Dashboard shell sidebar', () => {
    test('shows the platform sidebar-toggle shortcut', async ({ page }) => {
        await page.goto('/');
        const trigger = page.locator('[data-sidebar="trigger"]').first();
        await trigger.hover();
        await expect(page.getByText(/Toggle sidebar/)).toBeVisible();
        await expect(page.getByText(/(⌘B|Ctrl\+B)/)).toBeVisible();
    });

    test('navigates with keytips and restores a collapsed sidebar', async ({ page }) => {
        await page.goto('/');
        const sidebar = page.locator('[data-slot="sidebar"]');
        await page.locator('[data-sidebar="trigger"]').first().click();
        await expect(sidebar).toHaveAttribute('data-state', 'collapsed');

        await page.keyboard.down('g');
        await expect(sidebar).toHaveAttribute('data-state', 'expanded');
        await expect(sidebar.getByText('P', { exact: true })).toBeVisible();
        await page.keyboard.up('g');
        await expect(sidebar).toHaveAttribute('data-state', 'collapsed');

        await page.keyboard.down('g');
        await expect(sidebar).toHaveAttribute('data-state', 'expanded');
        await page.waitForTimeout(1_750);
        await expect(sidebar).toHaveAttribute('data-state', 'expanded');
        await page.keyboard.up('g');
        await expect(sidebar).toHaveAttribute('data-state', 'collapsed');

        await page.keyboard.down('g');
        await page.keyboard.press('p');
        await page.keyboard.up('g');
        await expect(page).toHaveURL(/\/products(?:\?.*)?$/);
        await expect(sidebar).toHaveAttribute('data-state', 'collapsed');
    });

    test('collapses administration while showing keytips and restores it afterwards', async ({ page }) => {
        await page.goto('/global-settings');
        const sidebar = page.locator('[data-slot="sidebar"]');
        const globalSettings = sidebar.getByText('Global Settings', { exact: true });
        await expect(globalSettings).toBeVisible();

        await page.keyboard.down('g');
        await expect(globalSettings).toBeHidden();
        await expect(sidebar.getByText('P', { exact: true })).toBeVisible();

        await page.keyboard.up('g');
        await expect(globalSettings).toBeVisible();

        await page.goto('/');
        await expect(sidebar.getByText('Insights', { exact: true })).toBeVisible();
        await page.keyboard.down('g');
        await expect(sidebar.getByText('P', { exact: true })).toBeVisible();
        await page.keyboard.press('s');
        await page.keyboard.up('g');
        await expect(page).toHaveURL(/\/global-settings$/);
    });

    test('does not trigger navigation while typing', async ({ page }) => {
        await page.goto('/profile');
        const firstName = page
            .locator('[data-slot="field"]')
            .filter({ hasText: 'First name' })
            .getByRole('textbox');
        await firstName.focus();
        await page.keyboard.type('gp');
        await expect(page).toHaveURL(/\/profile$/);
    });
});
