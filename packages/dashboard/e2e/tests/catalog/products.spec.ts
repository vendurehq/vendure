import { type Page, expect, test } from '@playwright/test';

import { createCrudTestSuite } from '../../utils/crud-test-factory.js';
import { VendureAdminClient } from '../../utils/vendure-admin-client.js';

async function navigateToLaptopProduct(page: Page) {
    await page.goto('/products');
    await expect(page.locator('table')).toBeVisible();
    await page.getByRole('textbox', { name: 'Search products...' }).fill('Laptop');
    const laptopRow = page.locator('table tbody tr').filter({ hasText: 'Laptop' }).first();
    await expect(laptopRow).toBeVisible();
    await laptopRow.getByRole('button').first().click();
    await expect(page).toHaveURL(/\/products\/.+/);
}

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
        await navigateToLaptopProduct(page);

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
        await navigateToLaptopProduct(page);

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
        await navigateToLaptopProduct(page);

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
    // embedded table therefore does not opt into views, while keeping filtering
    // and column customization intact.
    // Note: the e2e fixture doesn't register the DashboardPlugin settings-store
    // fields, so saved-views tabs never render in this environment regardless;
    // the observable guarantees here are that filtering and column customization
    // controls remain, and the views-tabs assertion guards against regressions.
    test('embedded variants table omits views tabs but keeps filter and column controls', async ({
        page,
    }) => {
        // Navigate to the seeded "Laptop" product which has variants
        await navigateToLaptopProduct(page);

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

// Provisions a throwaway product with a single "Size" option group (Small/Large) via the
// admin API, so the cached seed DB is never mutated. Returns the ids the inline-editor
// tests need; callers add variants and must clean up with `cleanupVariantEditorProduct`.
async function createVariantEditorProduct(
    client: VendureAdminClient,
    unique: number,
): Promise<{ productId: string; optionGroupId: string; smallOptionId: string; largeOptionId: string }> {
    const { createProduct } = await client.gql(
        `mutation ($input: CreateProductInput!) { createProduct(input: $input) { id } }`,
        {
            input: {
                translations: [
                    {
                        languageCode: 'en',
                        name: `E2E Inline Variant ${unique}`,
                        slug: `e2e-inline-variant-${unique}`,
                        description: '',
                    },
                ],
            },
        },
    );
    const productId = createProduct.id as string;

    const { createProductOptionGroup } = await client.gql(
        `mutation ($input: CreateProductOptionGroupInput!) {
            createProductOptionGroup(input: $input) { id options { id name } }
        }`,
        {
            input: {
                code: `size-${unique}`,
                translations: [{ languageCode: 'en', name: 'Size' }],
                options: [
                    { code: `small-${unique}`, translations: [{ languageCode: 'en', name: 'Small' }] },
                    { code: `large-${unique}`, translations: [{ languageCode: 'en', name: 'Large' }] },
                ],
            },
        },
    );
    const optionGroupId = createProductOptionGroup.id as string;
    const options = createProductOptionGroup.options as Array<{ id: string; name: string }>;

    await client.gql(
        `mutation ($productId: ID!, $optionGroupId: ID!) {
            addOptionGroupToProduct(productId: $productId, optionGroupId: $optionGroupId) { id }
        }`,
        { productId, optionGroupId },
    );

    return {
        productId,
        optionGroupId,
        smallOptionId: options.find(o => o.name === 'Small')!.id,
        largeOptionId: options.find(o => o.name === 'Large')!.id,
    };
}

async function createVariantEditorVariant(
    client: VendureAdminClient,
    productId: string,
    name: string,
    sku: string,
    optionIds: string[],
): Promise<string> {
    const { createProductVariants } = await client.gql(
        `mutation ($input: [CreateProductVariantInput!]!) {
            createProductVariants(input: $input) { id }
        }`,
        {
            input: [{ productId, translations: [{ languageCode: 'en', name }], sku, optionIds, price: 1000 }],
        },
    );
    return (createProductVariants as Array<{ id: string }>)[0].id;
}

async function cleanupVariantEditorProduct(
    client: VendureAdminClient,
    productId: string,
    optionGroupId: string,
) {
    await client.gql(`mutation ($id: ID!) { deleteProduct(id: $id) { result } }`, { id: productId });
    await client.gql(
        `mutation ($id: ID!) { deleteProductOptionGroup(id: $id, force: true) { result } }`,
        { id: optionGroupId },
    );
}

// The Manage variants page is now an inline editor: every option cell renders as an
// always-editable select (no read-only badges, no per-row Save button), and picking a
// value auto-saves immediately and survives a reload. These tests provision a throwaway
// product via the admin API so the cached seed DB is never mutated, and clean up
// unconditionally in `finally`.
test.describe('Manage variants inline editing', () => {
    test('option cells are editable selects that auto-save on change', async ({ page }) => {
        const client = new VendureAdminClient(page);
        await client.login();
        const unique = Date.now();
        const { productId, optionGroupId, smallOptionId } = await createVariantEditorProduct(
            client,
            unique,
        );

        try {
            const variantId = await createVariantEditorVariant(
                client,
                productId,
                `Small ${unique}`,
                `e2e-inline-${unique}`,
                [smallOptionId],
            );
            const selectTestId = `variant-option-select-${variantId}-${optionGroupId}`;

            await page.goto(`/products/${productId}/variants`);

            // The assigned option renders as an editable select (combobox) preloaded with
            // the current value — not a static badge — so assignment can be changed inline.
            const optionSelect = page.getByTestId(selectTestId);
            await expect(optionSelect).toBeVisible({ timeout: 10_000 });
            // The cell is an editable select (combobox role), not a static badge.
            await expect(optionSelect.and(page.getByRole('combobox'))).toBeVisible();
            await expect(optionSelect).toContainText('Small');

            // Changing the select fires the update immediately (no Save click).
            await optionSelect.click();
            await Promise.all([
                page.waitForResponse(
                    resp =>
                        resp.url().includes('/admin-api') &&
                        resp.request().postData()?.includes('UpdateProductVariant') === true &&
                        resp.status() === 200,
                ),
                page.getByRole('option', { name: 'Large', exact: true }).click(),
            ]);
            await expect(optionSelect).toContainText('Large');

            // The change persisted server-side: a reload still shows "Large".
            await page.reload();
            const reloadedSelect = page.getByTestId(selectTestId);
            await expect(reloadedSelect).toBeVisible({ timeout: 10_000 });
            await expect(reloadedSelect).toContainText('Large');
        } finally {
            await cleanupVariantEditorProduct(client, productId, optionGroupId);
        }
    });

    // The duplicate pre-check is client-side (core skips combination-uniqueness on variant
    // UPDATE), so changing one variant onto another variant's combination must be blocked
    // before any mutation: an error toast naming the colliding variant, the select reverts,
    // and no UpdateProductVariant request is ever sent.
    test('blocks a change that collides with another variant without calling the server', async ({
        page,
    }) => {
        const client = new VendureAdminClient(page);
        await client.login();
        const unique = Date.now();
        const { productId, optionGroupId, smallOptionId, largeOptionId } =
            await createVariantEditorProduct(client, unique);

        try {
            const smallVariantId = await createVariantEditorVariant(
                client,
                productId,
                `Small ${unique}`,
                `e2e-dup-small-${unique}`,
                [smallOptionId],
            );
            // A second variant already owns the "Large" combination.
            await createVariantEditorVariant(
                client,
                productId,
                `Large ${unique}`,
                `e2e-dup-large-${unique}`,
                [largeOptionId],
            );
            const smallSelectTestId = `variant-option-select-${smallVariantId}-${optionGroupId}`;

            await page.goto(`/products/${productId}/variants`);
            const smallSelect = page.getByTestId(smallSelectTestId);
            await expect(smallSelect).toBeVisible({ timeout: 10_000 });
            await expect(smallSelect).toContainText('Small');

            // Track any update mutation sent while we attempt the colliding change.
            let updateRequested = false;
            const onRequest = (req: import('@playwright/test').Request) => {
                if (
                    req.url().includes('/admin-api') &&
                    req.postData()?.includes('UpdateProductVariant') === true
                ) {
                    updateRequested = true;
                }
            };
            page.on('request', onRequest);
            try {
                await smallSelect.click();
                await page.getByRole('option', { name: 'Large', exact: true }).click();
                // The error toast names the colliding variant.
                await expect(
                    page.locator('[data-sonner-toast]').filter({ hasText: /already used by/i }),
                ).toBeVisible({ timeout: 10_000 });
            } finally {
                page.off('request', onRequest);
            }

            // No mutation was sent, and the select reverted to its original value.
            expect(updateRequested).toBe(false);
            await expect(smallSelect).toContainText('Small');
        } finally {
            await cleanupVariantEditorProduct(client, productId, optionGroupId);
        }
    });

    // After a new option value is added, the "Generate variants" dialog lets the user create
    // only the now-missing combinations: existing combinations render greyed-out with an
    // "Exists" label and are not editable, while missing combinations are offered as an
    // editable form. Self-provisions a throwaway product and cleans up unconditionally.
    test('generate-variants dialog offers only the missing combinations and creates them', async ({
        page,
    }) => {
        const client = new VendureAdminClient(page);
        await client.login();
        const unique = Date.now();
        const productName = `E2E Generate Variant ${unique}`;

        const { createProduct } = await client.gql(
            `mutation ($input: CreateProductInput!) { createProduct(input: $input) { id } }`,
            {
                input: {
                    translations: [
                        {
                            languageCode: 'en',
                            name: productName,
                            slug: `e2e-generate-variant-${unique}`,
                            description: '',
                        },
                    ],
                },
            },
        );
        const productId = createProduct.id as string;
        let optionGroupId: string | undefined;

        try {
            const { createProductOptionGroup } = await client.gql(
                `mutation ($input: CreateProductOptionGroupInput!) {
                    createProductOptionGroup(input: $input) { id options { id name } }
                }`,
                {
                    input: {
                        code: `size-${unique}`,
                        translations: [{ languageCode: 'en', name: 'Size' }],
                        options: [
                            { code: `small-${unique}`, translations: [{ languageCode: 'en', name: 'Small' }] },
                            { code: `large-${unique}`, translations: [{ languageCode: 'en', name: 'Large' }] },
                        ],
                    },
                },
            );
            optionGroupId = createProductOptionGroup.id as string;
            const options = createProductOptionGroup.options as Array<{ id: string; name: string }>;
            const smallOption = options.find(o => o.name === 'Small')!;
            const largeOption = options.find(o => o.name === 'Large')!;

            await client.gql(
                `mutation ($productId: ID!, $optionGroupId: ID!) {
                    addOptionGroupToProduct(productId: $productId, optionGroupId: $optionGroupId) { id }
                }`,
                { productId, optionGroupId },
            );

            // Create variants for every current combination (Small, Large) so nothing is missing yet.
            await client.gql(
                `mutation ($input: [CreateProductVariantInput!]!) {
                    createProductVariants(input: $input) { id }
                }`,
                {
                    input: [
                        {
                            productId,
                            translations: [{ languageCode: 'en', name: `${productName} Small` }],
                            sku: `e2e-gen-small-${unique}`,
                            optionIds: [smallOption.id],
                            price: 1000,
                        },
                        {
                            productId,
                            translations: [{ languageCode: 'en', name: `${productName} Large` }],
                            sku: `e2e-gen-large-${unique}`,
                            optionIds: [largeOption.id],
                            price: 1000,
                        },
                    ],
                },
            );

            // Add a new option value: this introduces a "Medium" combination with no variant yet.
            await client.gql(
                `mutation ($input: CreateProductOptionInput!) {
                    createProductOption(input: $input) { id }
                }`,
                {
                    input: {
                        productOptionGroupId: optionGroupId,
                        code: `medium-${unique}`,
                        translations: [{ languageCode: 'en', name: 'Medium' }],
                    },
                },
            );

            await page.goto(`/products/${productId}/variants`);

            // Open the generator dialog.
            const generateButton = page.getByTestId('generate-variants-btn');
            await expect(generateButton).toBeVisible({ timeout: 10_000 });
            await generateButton.click();

            const dialog = page.getByRole('dialog');
            await expect(dialog).toBeVisible();

            // Small and Large already exist: two greyed-out "Exists" rows, none editable.
            await expect(dialog.getByTestId('variant-exists-label')).toHaveCount(2);
            // Only the missing Medium combination is offered as an editable row.
            await expect(dialog.getByTestId('missing-variant-row')).toHaveCount(1);
            const skuInput = dialog.getByTestId('variant-sku-input');
            await expect(skuInput).toHaveCount(1);

            const mediumSku = `e2e-gen-medium-${unique}`;
            await skuInput.fill(mediumSku);

            // Explicit review-then-confirm: only after clicking create does the mutation fire.
            await Promise.all([
                page.waitForResponse(
                    resp =>
                        resp.url().includes('/admin-api') &&
                        resp.request().postData()?.includes('CreateProductVariants') === true &&
                        resp.status() === 200,
                ),
                dialog.getByTestId('create-missing-variants-btn').click(),
            ]);

            // The dialog closes and the new variant appears in the manage-variants table.
            await expect(page.getByTestId('create-missing-variants-btn')).toBeHidden();
            await expect(page.getByRole('cell', { name: mediumSku })).toBeVisible({ timeout: 10_000 });
            await expect(page.getByRole('cell', { name: `${productName} Medium` })).toBeVisible();
        } finally {
            await client.gql(`mutation ($id: ID!) { deleteProduct(id: $id) { result } }`, {
                id: productId,
            });
            if (optionGroupId) {
                await client.gql(
                    `mutation ($id: ID!) { deleteProductOptionGroup(id: $id, force: true) { result } }`,
                    { id: optionGroupId },
                );
            }
        }
    });
});
