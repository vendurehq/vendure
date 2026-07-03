import { expect, test } from '@playwright/test';

import { BaseListPage } from '../../page-objects/list-page.base.js';
import { createCrudTestSuite } from '../../utils/crud-test-factory.js';
import { VendureAdminClient } from '../../utils/vendure-admin-client.js';

// Unique per run so repeated local runs (which don't reset the DB) don't leave duplicates that
// would break the final row-count assertion.
const DELETE_TARGET_NAME = `E2E Delete Dialog Location ${Date.now()}`;

test.describe('Stock Locations', () => {
    test.describe.configure({ mode: 'serial' });

    createCrudTestSuite({
        entityName: 'stock location',
        entityNamePlural: 'stock locations',
        listPath: '/stock-locations',
        listTitle: 'Stock Locations',
        newButtonLabel: 'New Stock Location',
        newPageTitle: 'New stock location',
        createFields: [
            { label: 'Name', value: 'E2E Test Warehouse' },
            { label: 'Description', value: 'A test warehouse for e2e testing' },
        ],
        updateFields: [
            { label: 'Name', value: 'E2E Test Warehouse Updated' },
            { label: 'Description', value: 'Updated test warehouse description' },
        ],
        // Stock locations use a bespoke delete dialog (transfer/discard remaining stock) rather
        // than the generic confirm the factory drives, so bulk delete is covered by the test below.
        hasBulkDelete: false,
    });

    // #4641 — Deleting a stock location previously always failed because the shared bulk-delete
    // action sent `{ ids }` while `deleteStockLocations` requires `input: [DeleteStockLocationInput!]!`.
    // This drives the real dialog end-to-end; if the mutation variables regress, the delete fails
    // and no success toast appears.
    test('should bulk-delete a stock location via the transfer/discard dialog', async ({ page }) => {
        // Seed a throwaway location via the API so the test is self-contained.
        const client = new VendureAdminClient(page);
        await client.login();
        await client.gql(
            `mutation ($input: CreateStockLocationInput!) {
                createStockLocation(input: $input) { id }
            }`,
            { input: { name: DELETE_TARGET_NAME } },
        );

        const listPage = new BaseListPage(page, {
            path: '/stock-locations',
            title: 'Stock Locations',
            newButtonLabel: 'New Stock Location',
        });
        await listPage.goto();
        await listPage.expectLoaded();
        await listPage.search(DELETE_TARGET_NAME);

        const row = listPage.getRows().filter({ hasText: DELETE_TARGET_NAME });
        await expect(row.first()).toBeVisible();
        await row.first().getByRole('checkbox').click();

        await page.getByRole('button', { name: /Actions/i }).click();
        await page.locator('[role="menu"]').getByText('Delete', { exact: true }).click();

        // Custom delete dialog: choose what to do with any remaining stock, then confirm.
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByText('Delete stock locations')).toBeVisible();
        await dialog.getByRole('combobox').click();
        await page.getByRole('option', { name: /Discard remaining stock/i }).click();
        await dialog.getByRole('button', { name: 'Delete', exact: true }).click();

        await listPage.expectSuccessToast();
        await expect(listPage.getRows().filter({ hasText: DELETE_TARGET_NAME })).toHaveCount(0);
    });
});
