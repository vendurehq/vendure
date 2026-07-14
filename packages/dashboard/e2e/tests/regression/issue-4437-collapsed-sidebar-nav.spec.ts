import { expect, test } from '@playwright/test';

// Regression: https://github.com/vendurehq/vendure/issues/4437
//
// When the sidebar is collapsed, nav items with sub-items (e.g. Catalog)
// were not accessible. The fix shows a HoverCard popover on hover so
// sub-items can still be reached.

test.describe('Issue #4437: Collapsed sidebar nav items with sub-items', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        // Wait for dashboard to fully load
        await expect(page.locator('[data-slot="sidebar"]')).toBeVisible({ timeout: 15_000 });
    });

    test('should show hover card with sub-items when hovering collapsed nav section', async ({ page }) => {
        const sidebar = page.locator('[data-slot="sidebar"]');

        // Collapse the sidebar by clicking the trigger button
        await page.locator('[data-sidebar="trigger"]').first().click();
        await expect(sidebar).toHaveAttribute('data-state', 'collapsed');

        // Hover over the Catalog nav item (a section with sub-items like Products, Facets, Collections)
        const catalogButton = sidebar.getByRole('button', { name: 'Catalog' });
        await catalogButton.hover();

        // The hover card popover should appear with the section title and sub-item links
        const hoverCardContent = page.locator('[data-slot="hover-card-content"]');
        await expect(hoverCardContent).toBeVisible({ timeout: 5_000 });

        // Verify the hover card contains the section title
        await expect(hoverCardContent.getByTestId('sidebar-hover-title')).toHaveText('Catalog');

        // Verify sub-item links are present
        await expect(hoverCardContent.getByRole('link', { name: 'Products' })).toBeVisible();
        await expect(hoverCardContent.getByRole('link', { name: 'Facets' })).toBeVisible();
        await expect(hoverCardContent.getByRole('link', { name: 'Collections' })).toBeVisible();
    });

    test('should navigate to sub-item when clicking link in collapsed sidebar hover card', async ({
        page,
    }) => {
        const sidebar = page.locator('[data-slot="sidebar"]');

        // Collapse the sidebar
        await page.locator('[data-sidebar="trigger"]').first().click();
        await expect(sidebar).toHaveAttribute('data-state', 'collapsed');

        // Hover over Catalog to open hover card
        const catalogButton = sidebar.getByRole('button', { name: 'Catalog' });
        await catalogButton.hover();

        const hoverCardContent = page.locator('[data-slot="hover-card-content"]');
        await expect(hoverCardContent).toBeVisible({ timeout: 5_000 });

        // Click the "Products" link in the hover card
        await hoverCardContent.getByRole('link', { name: 'Products' }).click();

        // Verify navigation occurred
        await expect(page).toHaveURL(/\/products/, { timeout: 5_000 });
    });
});
