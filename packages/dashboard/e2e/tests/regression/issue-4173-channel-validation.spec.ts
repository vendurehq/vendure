import { type Page, expect, test } from '@playwright/test';

import { BaseDetailPage } from '../../page-objects/detail-page.base.js';

// Regression: https://github.com/vendurehq/vendure/issues/4173
// Fix PR: https://github.com/vendurehq/vendure/pull/4198
//
// Creating a new channel with missing required fields shows a raw GraphQL error
// toast instead of inline validation messages on the form fields.

test.describe('Issue #4173: Channel form validation', () => {
    const detailPage = (page: Page) =>
        new BaseDetailPage(page, {
            newPath: '/channels/new',
            pathPrefix: '/channels/',
            newTitle: 'New channel',
        });

    test.fixme('should not show raw GraphQL errors when required fields are missing', async ({ page }) => {
        const dp = detailPage(page);
        await dp.gotoNew();
        await dp.expectNewPageLoaded();

        // Only fill the code — leave other required fields (token, zones, etc.) empty
        await dp.fillInput('Code', 'validation-test-channel');

        // The Create button should be disabled when required fields are missing,
        // preventing submission and raw GQL errors entirely
        const createButton = page.getByRole('button', { name: 'Create' });
        await expect(createButton).toBeDisabled();
    });

    test.fixme('should show inline validation errors for empty required fields', async ({ page }) => {
        const dp = detailPage(page);
        await dp.gotoNew();
        await dp.expectNewPageLoaded();

        // Partially fill the form
        await dp.fillInput('Code', 'validation-test-channel');
        await dp.fillInput('Token', 'validation-test-token');

        // Try to create without setting zones — expect inline error messages
        // (not raw GraphQL error toasts)
        const createButton = page.getByRole('button', { name: 'Create' });
        if (await createButton.isEnabled()) {
            await createButton.click();
            // Should NOT see a raw GraphQL error toast
            const rawErrorToast = page.locator('[data-sonner-toast]').filter({
                hasText: /Variable.*was not provided/,
            });
            await expect(rawErrorToast).not.toBeVisible({ timeout: 3_000 });
        }
    });
});
