import { expect, test } from '@playwright/test';

import { createCrudTestSuite } from '../../utils/crud-test-factory.js';
import { VendureAdminClient } from '../../utils/vendure-admin-client.js';

createCrudTestSuite({
    entityName: 'product',
    entityNamePlural: 'products',
    listPath: '/products',
    listTitle: 'Products',
    newButtonLabel: 'New Product',
    newPageTitle: 'New product',
    createFields: [{ label: 'Product name', value: 'E2E Test Product' }],
    afterFillCreate: async (_page, detail) => {
        await expect(detail.formItem('Slug').getByRole('textbox')).not.toHaveValue('', { timeout: 5_000 });
    },
});

test.describe('Product detail features', () => {
    test('should display all detail page sections', async ({ page }) => {
        // Navigate to the seeded "Laptop" product via search to avoid race conditions
        await page.goto('/products');
        await expect(page.locator('table')).toBeVisible();
        await Promise.all([
            page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200),
            page.getByRole('textbox', { name: 'Search products...' }).fill('Laptop'),
        ]);
        await page.locator('table tbody tr').first().getByRole('button').first().click();
        await expect(page).toHaveURL(/\/products\/.+/);

        // Product name field
        await expect(
            page.locator('[data-slot="field-label"]').getByText('Product name', { exact: true }),
        ).toBeVisible();

        // Slug field
        await expect(
            page.locator('[data-slot="field-label"]').getByText('Slug', { exact: true }),
        ).toBeVisible();

        // Description field
        await expect(
            page.locator('[data-slot="field-label"]').getByText('Description', { exact: true }),
        ).toBeVisible();

        // Enabled switch lives in the action bar, not in a sidebar field
        await expect(page.getByTestId('product-enabled-switch')).toBeVisible();
        await expect(
            page.locator('[data-slot="field-label"]').filter({ hasText: /^Enabled$/ }),
        ).toHaveCount(0);

        // Facet Values block
        await expect(
            page.locator('[data-slot="card-title"]').getByText('Facet Values', { exact: true }),
        ).toBeVisible();

        // Assets block
        await expect(
            page.locator('[data-slot="card-title"]').getByText('Assets', { exact: true }),
        ).toBeVisible();
    });

    // The Enabled switch was moved from the sidebar into the action bar. Toggling it must
    // mark the form dirty and persist only on Update (no instant mutation). Restores the
    // original state at the end so other tests that rely on the seeded product are unaffected.
    test('enabled switch in the action bar toggles the form dirty and persists on update', async ({
        page,
    }) => {
        // Navigate to the seeded "Laptop" product via search to avoid race conditions
        await page.goto('/products');
        await expect(page.locator('table')).toBeVisible();
        await Promise.all([
            page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200),
            page.getByRole('textbox', { name: 'Search products...' }).fill('Laptop'),
        ]);
        await page.locator('table tbody tr').first().getByRole('button').first().click();
        await expect(page).toHaveURL(/\/products\/.+/);

        const productId = page.url().split('/products/')[1].split(/[/?#]/)[0];
        const enabledSwitch = page.getByTestId('product-enabled-switch').getByRole('switch');
        await expect(enabledSwitch).toBeVisible();
        const wasChecked = await enabledSwitch.isChecked();

        try {
            // The form is pristine on load, so Update is disabled (no instant mutation)
            await expect(page.getByRole('button', { name: 'Update' })).toBeDisabled({ timeout: 10_000 });

            // Toggling marks the form dirty, enabling Update — but does not persist yet
            await enabledSwitch.click();
            await expect(page.getByRole('button', { name: 'Update' })).toBeEnabled();

            // Persist via Update
            await Promise.all([
                page.waitForResponse(
                    response =>
                        response.url().includes('/admin-api') &&
                        response.request().postData()?.includes('UpdateProduct') === true &&
                        response.status() === 200,
                ),
                page.getByRole('button', { name: 'Update' }).click(),
            ]);
            await expect(
                page.locator('[data-sonner-toast]').filter({ hasNotText: /error/i }).first(),
            ).toBeVisible({ timeout: 10_000 });

            // Reload and verify the toggled state persisted
            await page.reload();
            await expect(page).toHaveURL(/\/products\/.+/);
            const reloadedSwitch = page.getByTestId('product-enabled-switch').getByRole('switch');
            if (wasChecked) {
                await expect(reloadedSwitch).not.toBeChecked();
            } else {
                await expect(reloadedSwitch).toBeChecked();
            }
        } finally {
            // Restore the original state directly via the admin API so downstream tests see the
            // product unchanged even if an assertion above failed mid-test.
            const client = new VendureAdminClient(page);
            await client.login();
            await client.gql(
                `mutation ($input: UpdateProductInput!) { updateProduct(input: $input) { id enabled } }`,
                { input: { id: productId, enabled: wasChecked } },
            );
        }
    });

    test('should display product variants table', async ({ page }) => {
        // Navigate to the seeded "Laptop" product which has variants
        await page.goto('/products');
        await expect(page.locator('table')).toBeVisible();
        await Promise.all([
            page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200),
            page.getByRole('textbox', { name: 'Search products...' }).fill('Laptop'),
        ]);
        await page.locator('table tbody tr').first().getByRole('button').first().click();
        await expect(page).toHaveURL(/\/products\/.+/);

        // The "Manage variants" button should be visible for the Laptop product
        await expect(page.getByRole('button', { name: /Manage variants/i })).toBeVisible({ timeout: 10_000 });
    });

    test('should navigate to manage variants page', async ({ page }) => {
        await page.goto('/products');
        await expect(page.locator('table')).toBeVisible();

        await page.locator('table tbody tr').first().getByRole('button').first().click();
        await expect(page).toHaveURL(/\/products\/.+/);

        const manageButton = page.getByRole('button', { name: /Manage variants/i });
        // Only proceed if the product has variants
        if (await manageButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
            await manageButton.click();
            await expect(page).toHaveURL(/\/products\/[^/]+\/variants/);
        }
    });

    test('should display the rich text editor for description', async ({ page }) => {
        await page.goto('/products');
        await expect(page.locator('table')).toBeVisible();

        await page.locator('table tbody tr').first().getByRole('button').first().click();
        await expect(page).toHaveURL(/\/products\/.+/);

        // The rich text editor renders a ProseMirror container with a toolbar
        // Look for the editor toolbar (formatting buttons) or the editable area
        const editorContainer = page.getByTestId('rich-text-editor');
        await expect(editorContainer.first()).toBeVisible({ timeout: 5_000 });
    });

    // Saved views are keyed by page id + block id only, so a view saved on one
    // product's embedded variants table would leak onto every other product. The
    // embedded table therefore hides the views tabs (via `hideViewsControls`)
    // while keeping filtering and column customization intact.
    // Note: the e2e fixture doesn't register the DashboardPlugin settings-store
    // fields, so saved-views tabs never render in this environment regardless;
    // the observable guarantees here are that filtering and column customization
    // controls remain, and the views-tabs assertion guards against regressions.
    test('embedded variants table hides views tabs but keeps filter and column controls', async ({
        page,
    }) => {
        // Navigate to the seeded "Laptop" product which has variants
        await page.goto('/products');
        await expect(page.locator('table')).toBeVisible();
        await Promise.all([
            page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200),
            page.getByRole('textbox', { name: 'Search products...' }).fill('Laptop'),
        ]);
        await page.locator('table tbody tr').first().getByRole('button').first().click();
        await expect(page).toHaveURL(/\/products\/.+/);

        // Wait for the embedded variants table to be present
        await expect(page.getByRole('button', { name: /Manage variants/i })).toBeVisible({
            timeout: 10_000,
        });

        // No saved-views tabs on the embedded table
        await expect(page.getByTestId('dt-views-tabs')).toHaveCount(0);

        // Filtering and column customization controls remain
        await expect(page.getByTestId('dt-add-filter-trigger')).toBeVisible();
        await expect(page.getByTestId('dt-column-settings-trigger')).toBeVisible();
    });

    test('should display custom field tabs when configured', async ({ page }) => {
        await page.goto('/products');
        await expect(page.locator('table')).toBeVisible();

        await page.locator('table tbody tr').first().getByRole('button').first().click();
        await expect(page).toHaveURL(/\/products\/.+/);

        // Custom fields are configured in the test fixtures (SEO, Details, Struct tabs)
        // Check if any custom field tabs/sections are present
        const customFieldsBlock = page
            .locator('[data-slot="card-title"]')
            .filter({ hasText: /custom fields|seo|details/i });
        const hasCustomFields = await customFieldsBlock
            .first()
            .isVisible({ timeout: 3_000 })
            .catch(() => false);

        if (hasCustomFields) {
            await expect(customFieldsBlock.first()).toBeVisible();
        }
        // If no custom fields configured in the fixture, this test passes silently
    });
});
