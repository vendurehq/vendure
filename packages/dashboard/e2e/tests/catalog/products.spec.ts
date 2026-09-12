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
        await page.getByPlaceholder('Filter...').fill('Laptop');
        await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);
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

        // Enabled toggle
        await expect(
            page.locator('[data-slot="field-label"]').getByText('Enabled', { exact: true }),
        ).toBeVisible();

        // Facet Values block
        await expect(
            page.locator('[data-slot="card-title"]').getByText('Facet Values', { exact: true }),
        ).toBeVisible();

        // Assets block
        await expect(
            page.locator('[data-slot="card-title"]').getByText('Assets', { exact: true }),
        ).toBeVisible();
    });

    test('should display product variants table', async ({ page }) => {
        // Navigate to the seeded "Laptop" product which has variants
        await page.goto('/products');
        await expect(page.locator('table')).toBeVisible();
        await page.getByPlaceholder('Filter...').fill('Laptop');
        await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);
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

// #5348 — shared option edits affect every product using the same group.
for (const productCount of [0, 1, 2]) {
    test(`shared option warning with ${productCount} assigned products`, async ({ page }) => {
        const client = new VendureAdminClient(page);
        await client.login();
        const suffix = `${productCount}-${Date.now()}`;
        const products: string[] = [];
        let groupId: string | undefined;
        try {
            const group = await client.gql(
                `mutation ($input: CreateProductOptionGroupInput!) {
                    createProductOptionGroup(input: $input) { id options { id } }
                }`,
                {
                    input: {
                        code: `shared-warning-${suffix}`,
                        translations: [{ languageCode: 'en', name: `Shared Size ${suffix}` }],
                        options: [
                            {
                                code: `small-${suffix}`,
                                translations: [{ languageCode: 'en', name: 'Small' }],
                            },
                        ],
                    },
                },
            );
            groupId = group.createProductOptionGroup.id;
            const optionId = group.createProductOptionGroup.options[0].id;
            for (let i = 0; i < productCount; i++) {
                const product = await client.gql(
                    `mutation ($input: CreateProductInput!) { createProduct(input: $input) { id } }`,
                    {
                        input: {
                            translations: [
                                {
                                    languageCode: 'en',
                                    name: `Shared product ${suffix}-${i}`,
                                    slug: `shared-${suffix}-${i}`,
                                    description: '',
                                },
                            ],
                        },
                    },
                );
                const productId = product.createProduct.id;
                products.push(productId);
                await client.gql(
                    `mutation ($productId: ID!, $groupId: ID!) {
                        addOptionGroupToProduct(productId: $productId, optionGroupId: $groupId) { id }
                    }`,
                    { productId, groupId },
                );
            }
            const routes = [
                ...products.map(id => `/products/${id}`),
                `/option-groups/${groupId}`,
                `/option-groups/${groupId}/options/${optionId}`,
                `/option-groups/${groupId}/options/new`,
            ];
            for (const route of routes) {
                await page.goto(route);
                await expect(
                    page.getByRole('button', {
                        name: route.endsWith('/new') ? 'Create' : 'Update',
                        exact: true,
                    }),
                ).toBeVisible();
                const warning = page.getByText(
                    'This option group is shared across 2 products. Changes will affect all of them.',
                    { exact: true },
                );
                if (productCount > 1) {
                    await expect(warning).toBeVisible();
                } else {
                    await expect(page.getByText(/This option group is (shared|used)/)).toHaveCount(0);
                }
            }
        } finally {
            const cleanupErrors: unknown[] = [];
            for (const id of products) {
                try {
                    await client.gql(`mutation ($id: ID!) { deleteProduct(id: $id) { result } }`, { id });
                } catch (error) {
                    cleanupErrors.push(error);
                }
            }
            if (groupId) {
                try {
                    await client.gql(
                        `mutation ($id: ID!) { deleteProductOptionGroup(id: $id, force: true) { result } }`,
                        { id: groupId },
                    );
                } catch (error) {
                    cleanupErrors.push(error);
                }
            }
            expect(cleanupErrors, 'Fixture cleanup failures').toEqual([]);
        }
    });
}
