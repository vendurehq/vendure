import { type Page, expect, test } from '@playwright/test';

import { BaseDetailPage } from '../../page-objects/detail-page.base.js';

// Regression: https://github.com/vendurehq/vendure/issues/4327
//
// When adding multiple collection filters of the same type (e.g. two "Filter by
// product variant name"), the input fields are incorrectly synchronized. Changing
// values in one filter causes all filters with the same code to update.

test.describe('Issue #4327: Collection filters with same type share state', () => {
    const detailPage = (page: Page) =>
        new BaseDetailPage(page, {
            newPath: '/collections/new',
            pathPrefix: '/collections/',
            newTitle: 'New collection',
        });

    test('should maintain independent state for two filters of the same type', async ({ page }) => {
        const dp = detailPage(page);
        await dp.gotoNew();
        await dp.expectNewPageLoaded();

        await dp.fillInput('Name', 'Filter State Test Collection');
        await expect(dp.formItem('Slug').getByRole('textbox')).not.toHaveValue('', { timeout: 5_000 });

        // Add first "Filter by product variant name" filter
        await page.getByRole('button', { name: /Add collection filter/i }).click();
        await page.getByRole('menuitem', { name: /Filter by product variant name/i }).click();

        // Fill the first filter's term input (identified by input name attribute,
        // which comes from the configurable operation arg name and is stable)
        const termInputs = page.locator('input[name="term"]');
        await termInputs.first().fill('shirt');

        // Add second "Filter by product variant name" filter
        await page.getByRole('button', { name: /Add collection filter/i }).click();
        await page.getByRole('menuitem', { name: /Filter by product variant name/i }).click();

        // Fill the second filter's term with a DIFFERENT value
        await page.locator('input[name="term"]').last().fill('pants');

        // Verify the first filter's term is still "shirt" (not overwritten by "pants")
        await expect(termInputs.first()).toHaveValue('shirt');
        // Verify the second filter's term is "pants"
        await expect(page.locator('input[name="term"]').last()).toHaveValue('pants');
    });
});
