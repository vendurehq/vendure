import { type Page, expect, test } from '@playwright/test';

import { BaseDetailPage } from '../../page-objects/detail-page.base.js';

// Regression: https://github.com/vendurehq/vendure/issues/4155
// Fix PR: https://github.com/vendurehq/vendure/pull/4339
//
// Creating an entity with nullable non-string custom fields (Int, Float, DateTime)
// failed because getDefaultValueFromField() returned '' instead of null for these types.
// The form either failed Zod validation or the GraphQL mutation rejected empty strings.
//
// PREREQUISITE: This test requires nullable non-string custom fields to be configured
// in global-setup.ts:
//
//   customFields: {
//       Product: [
//           { name: 'reviewRating', type: 'int' },
//           { name: 'weight', type: 'float' },
//           { name: 'releaseDate', type: 'datetime' },
//       ],
//   },

test.describe('Issue #4155: Nullable non-string custom field defaults', () => {
    test.describe.configure({ mode: 'serial' });

    const detailPage = (page: Page) =>
        new BaseDetailPage(page, {
            newPath: '/products/new',
            pathPrefix: '/products/',
            newTitle: 'New product',
        });

    test('should create a product without filling nullable non-string custom fields', async ({ page }) => {
        const dp = detailPage(page);
        await dp.gotoNew();
        await dp.expectNewPageLoaded();

        // Only fill required fields — leave nullable custom fields empty
        await dp.fillInput('Product name', 'Issue 4155 Test Product');
        await expect(dp.formItem('Slug').getByRole('textbox')).not.toHaveValue('', { timeout: 5_000 });

        // Wait for form validation to settle — the Create button becomes enabled
        // once defaults are generated and Zod validation passes
        await expect(dp.createButton).toBeEnabled({ timeout: 10_000 });

        // This should succeed: nullable fields should default to null, not ''
        await dp.clickCreate();
        await dp.expectSuccessToast(/Successfully created product/);
        await dp.expectNavigatedToExisting();
    });
});
