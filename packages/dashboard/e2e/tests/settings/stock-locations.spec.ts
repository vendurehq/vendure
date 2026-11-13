import { expect, test, type Page } from '@playwright/test';

import { BaseListPage } from '../../page-objects/list-page.base.js';
import { createCrudTestSuite } from '../../utils/crud-test-factory.js';
import { VendureAdminClient } from '../../utils/vendure-admin-client.js';

// Unique per run so repeated local runs (which don't reset the DB) don't leave duplicates that
// would break the final row-count assertion.
const RUN_ID = Date.now();
const DELETE_TARGET_NAME = `E2E Delete Dialog Location ${RUN_ID}`;

const CREATE_STOCK_LOCATION = `mutation ($input: CreateStockLocationInput!) {
    createStockLocation(input: $input) { id }
}`;

async function createLocation(client: VendureAdminClient, name: string): Promise<string> {
    const data = await client.gql(CREATE_STOCK_LOCATION, { input: { name } });
    return data.createStockLocation.id as string;
}

/** Sets `stockOnHand` for the first product variant at the given location, and returns its id. */
async function seedStock(client: VendureAdminClient, stockLocationId: string, stockOnHand: number) {
    const { productVariants } = await client.gql(
        `query { productVariants(options: { take: 1 }) { items { id } } }`,
    );
    const variantId = productVariants.items[0].id as string;
    await client.gql(
        `mutation ($input: [UpdateProductVariantInput!]!) {
            updateProductVariants(input: $input) { id }
        }`,
        { input: [{ id: variantId, stockLevels: [{ stockLocationId, stockOnHand }] }] },
    );
    return variantId;
}

async function getStockOnHand(client: VendureAdminClient, variantId: string, stockLocationId: string) {
    const { productVariant } = await client.gql(
        `query ($id: ID!) {
            productVariant(id: $id) { stockLevels { stockLocationId stockOnHand } }
        }`,
        { id: variantId },
    );
    return productVariant.stockLevels.find((l: any) => l.stockLocationId === stockLocationId)?.stockOnHand;
}

/** Selects the matching rows, opens the bespoke delete dialog and picks the given option. */
async function bulkDelete(page: Page, listPage: BaseListPage, searchTerm: string, optionName: RegExp) {
    await listPage.search(searchTerm);
    const rows = listPage.getRows().filter({ hasText: searchTerm });
    await expect(rows.first()).toBeVisible();
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
        await rows.nth(i).getByRole('checkbox').click();
    }

    await page.getByRole('button', { name: /Actions/i }).click();
    await page.locator('[role="menu"]').getByText('Delete', { exact: true }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Delete stock locations')).toBeVisible();
    await dialog.getByRole('combobox').click();
    await page.getByRole('option', { name: optionName }).click();
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
}

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
        await createLocation(client, DELETE_TARGET_NAME);

        const listPage = new BaseListPage(page, {
            path: '/stock-locations',
            title: 'Stock Locations',
            newButtonLabel: 'New Stock Location',
        });
        await listPage.goto();
        await listPage.expectLoaded();

        await bulkDelete(page, listPage, DELETE_TARGET_NAME, /Discard remaining stock/i);

        await listPage.expectSuccessToast();
        await expect(listPage.getRows().filter({ hasText: DELETE_TARGET_NAME })).toHaveCount(0);
    });

    // #4641 — the "transfer to another location" branch of the dialog. The discard test above only
    // exercises `transferToLocationId === undefined`, so a wrong id (or the `__discard__` sentinel
    // leaking through) would go unnoticed. Here the stock must actually land in the target location.
    test('should transfer remaining stock to the chosen location on delete', async ({ page }) => {
        const client = new VendureAdminClient(page);
        await client.login();
        const sourceName = `E2E Transfer Source ${RUN_ID}`;
        const targetName = `E2E Transfer Target ${RUN_ID}`;
        const sourceId = await createLocation(client, sourceName);
        const targetId = await createLocation(client, targetName);
        const variantId = await seedStock(client, sourceId, 42);

        const listPage = new BaseListPage(page, {
            path: '/stock-locations',
            title: 'Stock Locations',
            newButtonLabel: 'New Stock Location',
        });
        await listPage.goto();
        await listPage.expectLoaded();

        await bulkDelete(page, listPage, sourceName, new RegExp(`Transfer to ${targetName}`, 'i'));

        await listPage.expectSuccessToast();
        await expect(listPage.getRows().filter({ hasText: sourceName })).toHaveCount(0);
        expect(await getStockOnHand(client, variantId, targetId)).toBe(42);
    });

    // #4641 — the mutation input is built by mapping over the whole selection, so a multi-row
    // delete is the case an off-by-one or a single-item assumption would break.
    test('should bulk-delete multiple stock locations at once', async ({ page }) => {
        const client = new VendureAdminClient(page);
        await client.login();
        const sharedName = `E2E Multi Delete ${RUN_ID}`;
        await createLocation(client, `${sharedName} A`);
        await createLocation(client, `${sharedName} B`);

        const listPage = new BaseListPage(page, {
            path: '/stock-locations',
            title: 'Stock Locations',
            newButtonLabel: 'New Stock Location',
        });
        await listPage.goto();
        await listPage.expectLoaded();

        await bulkDelete(page, listPage, sharedName, /Discard remaining stock/i);

        await listPage.expectSuccessToast();
        await expect(listPage.getRows().filter({ hasText: sharedName })).toHaveCount(0);
    });
});
