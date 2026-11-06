import { expect, test } from '@playwright/test';

import { BaseDetailPage } from '../../page-objects/detail-page.base.js';
import { BaseListPage } from '../../page-objects/list-page.base.js';
import { VendureAdminClient } from '../../utils/vendure-admin-client.js';

// #5177, #5182 — selector dropdowns must reflect created and deleted entities
// without a reload. Do not add a page.goto() or page.reload() below the first
// one: either creates a fresh QueryClient and masks the bug under test.
test.describe('Entity selectors refetch after mutation', () => {
    const zoneName = `E2E Selector Zone ${Date.now()}`;

    // By name, so a failure anywhere still cleans up.
    test.afterEach(async ({ page }) => {
        const client = new VendureAdminClient(page);
        await client.login();
        const { zones } = await client.gql(
            `query ($name: String!) {
                zones(options: { filter: { name: { eq: $name } } }) { items { id } }
            }`,
            { name: zoneName },
        );
        for (const zone of zones.items) {
            await client.gql(`mutation ($id: ID!) { deleteZone(id: $id) { result } }`, { id: zone.id });
        }
    });

    test('shows a created zone and drops a deleted one, without reload', async ({ page }) => {
        const detail = new BaseDetailPage(page, {
            newPath: '/zones/new',
            pathPrefix: '/zones/',
            newTitle: 'New zone',
        });
        const sidebar = page.locator('[data-slot="sidebar"]');
        const gotoViaSidebar = (name: string) =>
            sidebar.getByRole('link', { name, exact: true }).click();

        const openTaxRateZoneDropdown = async () => {
            await gotoViaSidebar('Tax Rates');
            await page.getByRole('button', { name: 'New Tax Rate' }).click();
            await expect(page).toHaveURL(/\/tax-rates\/new$/);
            await detail.formItem('Zone').getByRole('combobox').click();
            // Guard: without this, toHaveCount(0) also passes if it never opened.
            await expect(page.getByRole('option').first()).toBeVisible();
        };

        await page.goto('/tax-rates');
        await expect(page.getByTestId('page-heading')).toBeVisible({ timeout: 10_000 });

        // Prime the ['zones'] cache while the zone does not exist.
        await openTaxRateZoneDropdown();
        await expect(page.getByRole('option', { name: zoneName })).toHaveCount(0);
        await page.keyboard.press('Escape');

        await gotoViaSidebar('Zones');
        await page.getByRole('button', { name: 'New Zone' }).click();
        await detail.fillInput('Name', zoneName);
        await detail.clickCreate();
        await detail.expectSuccessToast(/created/i);
        await detail.expectNavigatedToExisting();

        // Create case.
        await openTaxRateZoneDropdown();
        await expect(page.getByRole('option', { name: zoneName })).toBeVisible();
        await page.keyboard.press('Escape');

        // BaseListPage.goto() would reload, so arrive via the sidebar. The zones
        // list has no search box, so select the row by its unique name.
        await gotoViaSidebar('Zones');
        const list = new BaseListPage(page, {
            path: '/zones',
            title: 'Zones',
            newButtonLabel: 'New Zone',
        });
        await list.expectLoaded();
        const zoneRow = list.getRows().filter({ hasText: zoneName });
        await zoneRow.getByRole('checkbox').click();
        await page.getByRole('button', { name: /Actions/i }).click();
        await page.locator('[role="menu"]').getByText('Delete', { exact: true }).click();
        await page.locator('[role="alertdialog"]').getByRole('button', { name: 'Continue' }).click();
        await list.expectSuccessToast();
        await expect(list.getRows().filter({ hasText: zoneName })).toHaveCount(0);

        // Delete case: covers the invalidateQueries removed from the bulk actions.
        await openTaxRateZoneDropdown();
        await expect(page.getByRole('option', { name: zoneName })).toHaveCount(0);
    });
});
