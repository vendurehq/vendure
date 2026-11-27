import { expect, Page, test } from '@playwright/test';

import { LoginPage } from '../../page-objects/login-page.js';
import { VendureAdminClient } from '../../utils/vendure-admin-client.js';

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

    const storeReadinessResponse = (page: Page) =>
        page.waitForResponse(
            response =>
                response.url().includes('admin-api') &&
                (response.request().postData() ?? '').includes('StoreReadinessForSetupChecklist'),
        );

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
        await expect(checklist.getByRole('link', { name: 'Open' }).first()).toHaveAttribute(
            'href',
            /\/tax-rates$/,
        );

        // With an error, the button hides the card for this visit only.
        await checklist.getByRole('button', { name: 'Hide for now' }).click();
        await expect(checklist).toBeHidden();
        // Hidden for the session, the card does not even run the check.
        let queried = false;
        page.on('request', request => {
            if ((request.postData() ?? '').includes('StoreReadinessForSetupChecklist')) {
                queried = true;
            }
        });
        await page.reload();
        await expect(page.getByTestId('page-heading')).toBeVisible();
        await page.waitForLoadState('networkidle');
        expect(queried).toBe(false);
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
        const answered = storeReadinessResponse(page);
        await page.goto('/');
        await answered;
        await expect(page.getByTestId('page-heading')).toBeVisible();
        await page.waitForLoadState('networkidle');
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
        // The e2e suite signs in as the superadmin with the default password.
        await expect(checklist.locator('[data-code="store.auth.default-superadmin-password"]')).toBeVisible();
        await expect(checklist).not.toContainText('This server cannot check the store setup.');
    });

    // #5945 — the storeReadiness query needs ReadSettings, so an administrator without it gets
    // no card, not even when it is opened from the URL, and no "Setup" item in the user menu
    test('stays hidden for an administrator without ReadSettings', async ({ page, browser }) => {
        const client = new VendureAdminClient(page);
        await client.login();
        const suffix = `${Date.now()}-${Math.round(Math.random() * 1000)}`;
        const password = 'test-password';
        const emailAddress = `no-read-settings-${suffix}@test.com`;
        const { activeChannel } = await client.gql(`query { activeChannel { id } }`);
        const { createRole } = await client.gql(
            `mutation ($input: CreateRoleInput!) { createRole(input: $input) { id } }`,
            {
                input: {
                    code: `no-read-settings-${suffix}`,
                    description: 'Role without ReadSettings',
                    permissions: ['ReadCatalog', 'ReadOrder'],
                },
            },
        );
        const { createAdministrator } = await client.gql(
            `mutation ($input: CreateAdministratorInput!) { createAdministrator(input: $input) { id } }`,
            {
                input: {
                    firstName: 'No',
                    lastName: 'Settings',
                    emailAddress,
                    password,
                    roleAssignments: [{ roleId: createRole.id, channelId: activeChannel.id }],
                },
            },
        );
        const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
        try {
            const limitedPage = await context.newPage();
            const loginPage = new LoginPage(limitedPage);
            await loginPage.goto();
            await loginPage.login(emailAddress, password);
            await expect(limitedPage).not.toHaveURL(/\/login/);

            await limitedPage.goto('/?setup=true');
            await expect(limitedPage.getByTestId('page-heading')).toBeVisible();
            await limitedPage.waitForLoadState('networkidle');
            await expect(limitedPage.getByTestId('setup-checklist')).toHaveCount(0);

            await limitedPage.locator('[data-sidebar="footer"] [data-sidebar="menu-button"]').click();
            await expect(limitedPage.getByRole('menuitem', { name: 'Profile' })).toBeVisible();
            await expect(limitedPage.getByRole('menuitem', { name: 'Setup' })).toHaveCount(0);
        } finally {
            await context.close();
            await client.gql(`mutation ($ids: [ID!]!) { deleteAdministrators(ids: $ids) { result } }`, {
                ids: [createAdministrator.id],
            });
            await client.gql(`mutation ($ids: [ID!]!) { deleteRoles(ids: $ids) { result } }`, {
                ids: [createRole.id],
            });
        }
    });
});
