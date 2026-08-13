import { expect, test } from '@playwright/test';

import { VENDURE_PORT } from '../../constants.js';

// #4722 — focal point editor in the shared AssetPreview dialog, with a callback
// to EntityAssets so a re-opened dialog shows the saved value, not the stale one.
// Drives the seeded "Laptop" product's featured asset directly.
// Coverage note: the multi-asset gallery / prev-next sync path is not exercised
// here, since the seeded product has a single asset.
test.describe('Issue 4722 — focal point editor in shared asset preview dialog', () => {
    let productId: string;

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        productId = await page.evaluate(async vendurePort => {
            const apiUrl = `http://localhost:${vendurePort}/admin-api`;
            const sessionToken = localStorage.getItem('vendure-session-token');
            if (!sessionToken) throw new Error('No vendure-session-token');
            const post = async (query: string, variables?: Record<string, unknown>) => {
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
                if (json.errors?.length) throw new Error(`Admin API: ${JSON.stringify(json.errors)}`);
                return json.data;
            };

            const { product } = await post(`{ product(slug: "laptop") { id featuredAsset { id } } }`);
            if (!product?.featuredAsset) {
                throw new Error(
                    'Seeded "laptop" product has no featured asset — check core e2e CSV / importAssetsDir / stale __data__ DB',
                );
            }

            // Reset to "Not set" so each run (including retries) starts from a known baseline.
            await post(`mutation($input: UpdateAssetInput!) { updateAsset(input: $input) { id } }`, {
                input: { id: product.featuredAsset.id, focalPoint: null },
            });

            return product.id as string;
        }, VENDURE_PORT);
    });

    test('should let the user set a focal point from the preview dialog and persist across re-open', async ({
        page,
    }) => {
        test.setTimeout(45_000);

        await page.goto(`/products/${productId}`);

        // Target the <img> directly so the test doesn't depend on the asset URL scheme.
        const featuredImage = page.getByTestId('entity-assets-featured').locator('img');
        await expect(featuredImage).toBeVisible({ timeout: 15_000 });
        await featuredImage.click();

        const setFocalPointTrigger = page.getByTestId('asset-preview-set-focal-point');
        await expect(setFocalPointTrigger).toBeVisible({ timeout: 5_000 });

        // Baseline "Not set", so the transition below is a real state change.
        const focalPointValue = page.getByTestId('asset-preview-focal-point-value');
        await expect(focalPointValue).toContainText('Not set');

        // Confirm at the default centre. The exact dragged coordinate isn't asserted —
        // pixel-precise drag math is fragile; the Not-set → set → persist transition is the signal.
        await setFocalPointTrigger.click();
        await page.getByTestId('asset-focal-point-editor-confirm').click();

        // Toast not asserted — sonner auto-dismisses too fast to race reliably.
        await expect(focalPointValue).toContainText('0.50, 0.50', { timeout: 10_000 });

        // Re-open: the saved coords must persist. Before the parent-sync fix,
        // EntityAssets held the stale focal point and the dialog reported "Not set".
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toBeHidden({ timeout: 5_000 });

        await featuredImage.click();
        await expect(focalPointValue).toContainText('0.50, 0.50', { timeout: 5_000 });
    });
});
