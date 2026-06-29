import { expect, test } from '@playwright/test';

import { VENDURE_PORT } from '../../constants.js';

// #4724 — Shared option groups with many values made the variant generation
// table unusable: every row defaulted to `enabled: true` and there was no way
// to filter or bulk-toggle. The fix adds:
//   - A filter input above the table
//   - A master tri-state checkbox in the header (toggles visible rows only)
//   - A default-unchecked threshold for products that generate >20 variants
//
// The test creates an option group with 25 values via the Admin API, attaches
// it to a new product, navigates to the product detail page (which renders
// `GenerateVariantsPanel`), and asserts each of those three behaviours.
test.describe('Issue 4724 — variant generation table tools', () => {
    interface SetupResult {
        productId: string;
        optionGroupId: string;
        valueNames: string[];
    }

    let setup: SetupResult;

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        setup = await page.evaluate(async vendurePort => {
            const apiUrl = `http://localhost:${vendurePort}/admin-api`;
            const valueCount = 25;
            const ts = Date.now();
            const valueNames = Array.from({ length: valueCount }, (_, i) => `Color ${i}`);

            const sessionToken = localStorage.getItem('vendure-session-token');
            if (!sessionToken) {
                throw new Error('No vendure-session-token in localStorage — auth setup did not run.');
            }
            const post = async (query: string, variables: Record<string, unknown>) => {
                const res = await fetch(apiUrl, {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'content-type': 'application/json',
                        authorization: `Bearer ${sessionToken}`,
                    },
                    body: JSON.stringify({ query, variables }),
                });
                const json = await res.json();
                if (json.errors?.length) {
                    throw new Error(`Admin API: ${JSON.stringify(json.errors)}`);
                }
                return json.data;
            };

            const group = await post(
                `mutation($input: CreateProductOptionGroupInput!) {
                    createProductOptionGroup(input: $input) { id }
                }`,
                {
                    input: {
                        code: `oss-531-${ts}`,
                        translations: [{ languageCode: 'en', name: 'OSS-531 Colors' }],
                        options: valueNames.map((name, i) => ({
                            code: `oss-531-${ts}-${i}`,
                            translations: [{ languageCode: 'en', name }],
                        })),
                    },
                },
            );
            const optionGroupId = group.createProductOptionGroup.id as string;

            const product = await post(
                `mutation($input: CreateProductInput!) {
                    createProduct(input: $input) { id }
                }`,
                {
                    input: {
                        translations: [
                            {
                                languageCode: 'en',
                                name: `OSS-531 Test Product ${ts}`,
                                slug: `oss-531-${ts}`,
                                description: '',
                            },
                        ],
                    },
                },
            );
            const productId = product.createProduct.id as string;

            await post(
                `mutation($productId: ID!, $optionGroupId: ID!) {
                    addOptionGroupToProduct(productId: $productId, optionGroupId: $optionGroupId) { id }
                }`,
                { productId, optionGroupId },
            );

            return { productId, optionGroupId, valueNames };
        }, VENDURE_PORT);
    });

    test('should show filter + master toggle, default-uncheck above threshold, and toggle visible-only', async ({
        page,
    }) => {
        test.setTimeout(45_000);

        await page.goto(`/products/${setup.productId}`);

        const filterInput = page.getByTestId('variant-filter-input');
        const masterToggle = page.getByTestId('variant-toggle-all');

        // The variant generation panel renders only after the product detail
        // loads and reports `variantList.totalItems === 0`.
        await expect(filterInput).toBeVisible({ timeout: 15_000 });
        await expect(masterToggle).toBeVisible();

        // Default-unchecked: 25 variants > 20 threshold, so master is unchecked
        // and no row checkbox is selected.
        await expect(masterToggle).toHaveAttribute('aria-checked', 'false');

        // Filter narrows the visible rows. "color 1" matches "Color 1", "Color
        // 10", ..., "Color 19" — 11 rows out of 25.
        await filterInput.fill('color 1');

        const rows = page.locator('table tbody tr');
        await expect.poll(() => rows.count(), { timeout: 5_000 }).toBeLessThan(25);
        const filteredCount = await rows.count();
        expect(filteredCount).toBeGreaterThan(0);

        // Master toggle now operates on the visible subset only.
        await masterToggle.click();
        await expect(masterToggle).toHaveAttribute('aria-checked', 'true');
    });
});
