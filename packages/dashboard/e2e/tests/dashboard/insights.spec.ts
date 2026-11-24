import { expect, Page, test } from '@playwright/test';

test.describe('Dashboard Insights', () => {
    test('should display the insights page', async ({ page }) => {
        await page.goto('/');

        await expect(page.getByTestId('page-heading')).toBeVisible();
    });

    test('should display the date range picker', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByTestId('page-heading')).toBeVisible();

        const dateRangePicker = page.locator('[data-slot="date-range-picker"]').getByRole('button');
        await expect(dateRangePicker).toBeVisible();
    });

    test('should toggle edit layout mode', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByTestId('page-heading')).toBeVisible();

        // Click the icon-only "Edit layout" button
        const editButton = page.getByRole('button', { name: 'Edit layout' });
        await expect(editButton).toBeVisible();
        await editButton.click();

        // Button should change to "Save Layout"
        await expect(page.getByRole('button', { name: 'Save Layout' })).toBeVisible();

        // Click "Save Layout" to exit edit mode
        await page.getByRole('button', { name: 'Save Layout' }).click();

        // Button should return to the "Edit layout" icon button
        await expect(page.getByRole('button', { name: 'Edit layout' })).toBeVisible();
    });
});

test.describe('Setup checklist', () => {
    const finding = (code: string, severity: 'ERROR' | 'WARNING', message: string) => ({
        code,
        severity,
        message,
        fixes: [{ description: `Fix for ${code}` }],
        dashboardUrl: '/tax-rates',
    });

    /** Answers the checklist's storeReadiness query with `body`, and passes every other request on. */
    async function mockStoreReadiness(page: Page, body: unknown) {
        await page.route('**/admin-api**', async route => {
            if ((route.request().postData() ?? '').includes('StoreReadinessForSetupChecklist')) {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(body),
                });
            } else {
                await route.fallback();
            }
        });
    }

    test('lists the findings, keeps an error until the next visit, and reopens from the user menu', async ({
        page,
    }) => {
        await mockStoreReadiness(page, {
            data: {
                storeReadiness: {
                    ready: false,
                    findings: [
                        finding(
                            'store.tax.inclusive-rate-unknown',
                            'ERROR',
                            'No zone rate on the default tax zone',
                        ),
                        finding('store.auth.default-superadmin-password', 'WARNING', 'Default password'),
                    ],
                },
            },
        });
        await page.goto('/');
        const checklist = page.getByTestId('setup-checklist');
        await expect(checklist).toBeVisible();
        await expect(checklist.getByTestId('setup-checklist-item')).toHaveCount(2);
        await expect(checklist.getByText('No zone rate on the default tax zone')).toBeVisible();
        await expect(checklist.getByText('Fix for store.tax.inclusive-rate-unknown')).toBeVisible();
        await expect(checklist.getByRole('link', { name: 'Open' }).first()).toHaveAttribute(
            'href',
            /\/tax-rates$/,
        );

        // With an error, the button hides the card for this visit only.
        await checklist.getByRole('button', { name: 'Hide for now' }).click();
        await expect(checklist).toBeHidden();
        await page.reload();
        await expect(page.getByTestId('page-heading')).toBeVisible();
        await expect(checklist).toBeHidden();

        await page.locator('[data-sidebar="footer"] [data-sidebar="menu-button"]').click();
        await page.getByRole('menuitem', { name: 'Setup' }).click();
        await expect(page).toHaveURL(/setup=true/);
        await expect(checklist).toBeVisible();
    });

    test('stays out of the way on a server without the storeReadiness query', async ({ page }) => {
        await mockStoreReadiness(page, {
            errors: [{ message: 'Cannot query field "storeReadiness" on type "Query".' }],
        });
        await page.goto('/');
        await expect(page.getByTestId('page-heading')).toBeVisible();
        await expect(page.getByTestId('setup-checklist')).toBeHidden();

        // Opened on purpose, it says that the server cannot check the setup.
        await page.goto('/?setup=true');
        await expect(page.getByTestId('setup-checklist')).toContainText(
            'This server cannot check the store setup.',
        );
    });

    test('shows the report of the server when opened', async ({ page }) => {
        await page.goto('/?setup=true');
        const checklist = page.getByTestId('setup-checklist');
        await expect(checklist).toBeVisible();
        await expect(checklist).not.toContainText('This server cannot check the store setup.');
        await expect(checklist).not.toContainText('Checking the store setup');
    });
});
