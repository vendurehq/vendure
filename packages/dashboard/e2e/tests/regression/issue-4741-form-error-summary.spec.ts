import { expect, type Page, test } from '@playwright/test';

import { BaseDetailPage } from '../../page-objects/detail-page.base.js';

// `#4741` — Operation buttons are frequently disabled with no on-page prompts.
//
// When a detail-page form is invalid, the submit button is disabled. Previously
// there was no on-page indication of *why* — the validation error was only
// logged to the console. This regression verifies that the FormErrorSummary
// banner surfaces the reason. The `oss540NumericCode` product custom field
// (see e2e/fixtures/e2e-shared-config.ts) rejects non-numeric input, letting us
// drive the form into an invalid state deterministically.
test.describe('Issue #4741: disabled submit button surfaces a reason', () => {
    const detailPage = (page: Page) =>
        new BaseDetailPage(page, {
            newPath: '/products/new',
            pathPrefix: '/products/',
            newTitle: 'New product',
        });

    const SUMMARY_TITLE = 'This cannot be saved until the following are fixed:';

    test('shows a validation summary when a field value is invalid', async ({ page }) => {
        const dp = detailPage(page);
        await dp.gotoNew();
        await dp.expectNewPageLoaded();

        // A valid name on its own makes the form submittable…
        await dp.fillInput('Product name', 'OSS-540 error summary test');
        await expect(dp.createButton).toBeEnabled({ timeout: 10_000 });

        // …until a field is given an invalid value.
        await dp.fillInput('OSS-540 Numeric Code', 'abc');

        // The submit button is disabled (unchanged behaviour) AND the page now
        // explains why via the summary banner — the fix for #4741.
        await expect(dp.createButton).toBeDisabled();
        await expect(page.getByText(SUMMARY_TITLE)).toBeVisible();
        await expect(page.getByText('Value must match pattern: ^[0-9]*$').first()).toBeVisible();

        // Correcting the value clears the summary and re-enables the button.
        await dp.fillInput('OSS-540 Numeric Code', '12345');
        await expect(page.getByText(SUMMARY_TITLE)).toBeHidden();
        await expect(dp.createButton).toBeEnabled();
    });
});
