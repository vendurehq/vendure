import { expect, test } from '@playwright/test';

import { BaseListPage } from '../../page-objects/list-page.base.js';
import { createCrudTestSuite } from '../../utils/crud-test-factory.js';

const UPDATED_NAME = 'E2E Test Warehouse Updated';

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
            { label: 'Name', value: UPDATED_NAME },
            { label: 'Description', value: 'Updated test warehouse description' },
        ],
        // Stock locations use a bespoke delete dialog (transfer/discard remaining stock) rather
        // than the generic confirm the factory drives, so bulk delete is covered by the test below.
        hasBulkDelete: false,
    });

    // #4641 — Deleting a stock location previously always failed because the shared bulk-delete
    // action sent `{ ids }` while `deleteStockLocations` requires `input: [DeleteStockLocationInput!]!`.
    // This drives the real dialog end-to-end; if the mutation variables regress, the delete fails
    // and no success toast appears. Also cleans up the entity created by the CRUD suite above.
    test('should bulk-delete a stock location via the transfer/discard dialog', async ({ page }) => {
        const listPage = new BaseListPage(page, {
            path: '/stock-locations',
            title: 'Stock Locations',
            newButtonLabel: 'New Stock Location',
        });
        await listPage.goto();
        await listPage.expectLoaded();
        await listPage.search(UPDATED_NAME);

        const row = listPage.getRows().filter({ hasText: UPDATED_NAME });
        await expect(row.first()).toBeVisible();
        await row.first().getByRole('checkbox').click();

        await page.getByRole('button', { name: /With selected/i }).click();
        await page.getByRole('menuitem').filter({ hasText: 'Delete' }).click();

        // Custom delete dialog: choose what to do with any remaining stock, then confirm.
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByText('Delete stock locations')).toBeVisible();
        await dialog.getByRole('combobox').click();
        await page.getByRole('option', { name: /Discard remaining stock/i }).click();
        await dialog.getByRole('button', { name: 'Delete' }).click();

        await listPage.expectSuccessToast();
        await expect(listPage.getRows().filter({ hasText: UPDATED_NAME })).toHaveCount(0);
    });
});
