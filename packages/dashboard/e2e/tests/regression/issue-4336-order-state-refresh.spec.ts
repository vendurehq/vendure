import { expect, test } from '@playwright/test';

import { BaseListPage } from '../../page-objects/list-page.base.js';

// Regression: https://github.com/vendurehq/vendure/issues/4336
// Fix PR: https://github.com/vendurehq/vendure/pull/4338
//
// On the order detail page, using the state transition dropdown successfully
// transitions the order on the server, but the UI does not refresh to show
// the new state. The state badge and history still show old values until manual reload.
//
// NOTE: This test depends on the main orders test having created a completed order
// (in "ArrangingPayment" state via the dummyPaymentHandler).

test.describe('Issue #4336: Order state refresh after transition', () => {
    test.describe.configure({ mode: 'serial' });

    test.fixme('should update the UI after transitioning order state', async ({ page }) => {
        test.setTimeout(30_000);

        // Navigate to the orders list
        const lp = new BaseListPage(page, {
            path: '/orders',
            title: 'Orders',
            newButtonLabel: 'Draft order',
            newButtonRole: 'button',
        });
        await lp.goto();
        await lp.expectLoaded();

        // Click the first order (created by earlier tests, in "ArrangingPayment" state)
        const firstOrderRow = lp.getRows().first();
        await expect(firstOrderRow).toBeVisible();
        // Verify it's in ArrangingPayment state
        await expect(firstOrderRow.getByText('Arranging payment')).toBeVisible();
        await firstOrderRow.click();
        await expect(page).toHaveURL(/\/orders\/[^/]+$/);

        // Find the state transition control and verify current state
        await expect(page.getByText('Arranging payment')).toBeVisible();

        // Click the state transition dropdown (EllipsisVertical button next to state badge)
        // The state control has a button with the dropdown trigger
        const stateDropdownTrigger = page.getByTestId('state-transition-trigger');
        await stateDropdownTrigger.click();

        // Click "Transition to Payment Settled" (via dummyPaymentHandler, this should be available)
        // The menu items say "Transition to {state}"
        const settledMenuItem = page.getByRole('menuitem').filter({
            hasText: /Payment Settled/i,
        });

        // If PaymentSettled isn't directly available, try whatever transition IS available
        if (await settledMenuItem.isVisible()) {
            await settledMenuItem.click();
        } else {
            // Fall back to clicking the first available transition
            await page.getByRole('menuitem').first().click();
        }

        // Wait for the mutation to complete
        await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);

        // The state badge should now show the new state (NOT "Arranging payment")
        await expect(page.getByText('Arranging payment')).not.toBeVisible({ timeout: 5_000 });
    });
});
