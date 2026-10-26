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

        const termChips = page.getByRole('button', { name: 'term' });
        // Closed chip popovers can remain mounted (inert) in the DOM while
        // their exit transition runs, so scope to the currently-open popup.
        const termInput = page
            .locator('[data-slot="popover-content"][data-open]')
            .locator('input[name="term"]');

        // Add first "Filter by product variant name" filter. The popover for the
        // required "operator" arg auto-opens; dismiss it and edit the term chip.
        await page.getByRole('button', { name: /Add collection filter/i }).click();
        await page.getByRole('menuitem', { name: /Filter by product variant name/i }).click();
        await page.keyboard.press('Escape');
        await termChips.first().click();
        await termInput.fill('shirt');
        await page.keyboard.press('Escape');

        // The collapsed sentence chip now shows the value
        await expect(termChips.first()).toHaveText('shirt');

        // Add second "Filter by product variant name" filter with a DIFFERENT value
        await page.getByRole('button', { name: /Add collection filter/i }).click();
        await page.getByRole('menuitem', { name: /Filter by product variant name/i }).click();
        await page.keyboard.press('Escape');
        await termChips.last().click();
        await termInput.fill('pants');
        await page.keyboard.press('Escape');

        // Verify the first filter's term is still "shirt" (not overwritten by "pants")
        await expect(termChips.first()).toHaveText('shirt');
        // Verify the second filter's term is "pants"
        await expect(termChips.last()).toHaveText('pants');

        // Re-open the first filter's popover and verify its input value directly
        await termChips.first().click();
        await expect(termInput).toHaveValue('shirt');
    });
});
