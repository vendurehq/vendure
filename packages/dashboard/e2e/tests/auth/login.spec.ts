import { type Browser, expect, type Page, test } from '@playwright/test';

import {
    LS_KEY_SESSION_TOKEN,
    LS_KEY_USER_SETTINGS,
    SETTINGS_STORE_KEY_USER_SETTINGS,
} from '../../../src/lib/storage-keys.js';
import { LoginPage } from '../../page-objects/login-page.js';
import { VendureAdminClient } from '../../utils/vendure-admin-client.js';

// These tests need a clean browser with no saved auth state
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Login', () => {
    test('should display the login form', async ({ page }) => {
        const loginPage = new LoginPage(page);
        await loginPage.goto();
        await loginPage.expectVisible();
    });

    test('should login with valid credentials and redirect to home', async ({ page }) => {
        const loginPage = new LoginPage(page);
        await loginPage.goto();
        await loginPage.login('superadmin', 'superadmin');
        await expect(page).not.toHaveURL(/\/login/);
    });

    test('should show error with invalid credentials', async ({ page }) => {
        const loginPage = new LoginPage(page);
        await loginPage.goto();
        await loginPage.login('bad@email.com', 'wrongpassword');
        await loginPage.expectError();
    });

    test('should redirect to login when accessing protected route unauthenticated', async ({ page }) => {
        await page.goto('/products');
        await expect(page).toHaveURL(/\/login/);
    });
});

// #5617 — an administrator without access to any channel cannot use the Dashboard
test.describe('Administrator without access to any channel', () => {
    const password = 'test-password';

    async function createAdministrator(client: VendureAdminClient, channelIds?: string[]) {
        const suffix = `${Date.now()}-${Math.round(Math.random() * 1000)}`;
        const emailAddress = `no-channel-${suffix}@test.com`;
        const { createRole } = await client.gql(
            `mutation ($input: CreateRoleInput!) { createRole(input: $input) { id } }`,
            {
                input: {
                    code: `no-channel-${suffix}`,
                    description: 'Role for an administrator without channels',
                    permissions: ['ReadCatalog'],
                    channelIds,
                },
            },
        );
        const { createAdministrator: administrator } = await client.gql(
            `mutation ($input: CreateAdministratorInput!) { createAdministrator(input: $input) { id } }`,
            {
                input: {
                    firstName: 'No',
                    lastName: 'Channel',
                    emailAddress,
                    password,
                    roleIds: [createRole.id],
                },
            },
        );
        return {
            emailAddress,
            administratorId: administrator.id as string,
            roleId: createRole.id as string,
        };
    }

    // Removes the test data, so that later tests which reuse the e2e database do not see it
    async function cleanupAdministrator(
        client: VendureAdminClient,
        { administratorId, roleId }: { administratorId: string; roleId: string },
    ) {
        await client.gql(`mutation ($ids: [ID!]!) { deleteAdministrators(ids: $ids) { result } }`, {
            ids: [administratorId],
        });
        await client.gql(`mutation ($ids: [ID!]!) { deleteRoles(ids: $ids) { result } }`, { ids: [roleId] });
    }

    // A fresh browser context, so that the page is not signed in as the SuperAdmin
    async function newLoginPage(browser: Browser) {
        const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
        const page = await context.newPage();
        return { context, page, loginPage: new LoginPage(page) };
    }

    // Fails the first current-user request after the login, as a network error would
    async function failFirstCurrentUserRefetch(page: Page) {
        const state = { loginSent: false, failedRefetch: false };
        await page.route('**/admin-api**', async route => {
            const operation = route.request().postDataJSON()?.query ?? '';
            if (operation.includes('mutation Login')) {
                state.loginSent = true;
            } else if (
                state.loginSent &&
                !state.failedRefetch &&
                operation.includes('query CurrentUserInformation')
            ) {
                state.failedRefetch = true;
                return route.abort();
            }
            return route.continue();
        });
        return state;
    }

    test('shows an error and the login form after logging in', async ({ page, browser }) => {
        const client = new VendureAdminClient(page);
        await client.login();
        const administrator = await createAdministrator(client, []);
        const { context, page: adminPage, loginPage } = await newLoginPage(browser);
        try {
            await loginPage.goto();
            await loginPage.login(administrator.emailAddress, password);

            await expect(
                adminPage
                    .locator('[data-sonner-toast]')
                    .filter({ hasText: 'You do not have access to any channel' }),
            ).toBeVisible({ timeout: 10_000 });
            await loginPage.expectVisible();

            // The session was ended, so a reload still shows the login form
            await adminPage.reload();
            await loginPage.expectVisible();
        } finally {
            await context.close();
            await cleanupAdministrator(client, administrator);
        }
    });

    test('shows the login form after a reload when access to all channels was removed', async ({
        page,
        browser,
    }) => {
        const client = new VendureAdminClient(page);
        await client.login();
        const administrator = await createAdministrator(client);
        const { context, page: adminPage, loginPage } = await newLoginPage(browser);
        try {
            await loginPage.goto();
            await loginPage.login(administrator.emailAddress, password);
            await expect(adminPage).not.toHaveURL(/\/login/, { timeout: 15_000 });

            const { activeChannel } = await client.gql(`query { activeChannel { id } }`);
            await client.gql(`mutation ($input: UpdateRoleInput!) { updateRole(input: $input) { id } }`, {
                input: { id: administrator.roleId, channelIds: [] },
            });
            await adminPage.reload();

            await expect(
                adminPage
                    .locator('[data-sonner-toast]')
                    .filter({ hasText: 'You do not have access to any channel' }),
            ).toBeVisible({ timeout: 10_000 });
            await loginPage.expectVisible();

            // The session was ended, so it stays signed out even once the access is given back
            await client.gql(`mutation ($input: UpdateRoleInput!) { updateRole(input: $input) { id } }`, {
                input: { id: administrator.roleId, channelIds: [activeChannel.id] },
            });
            await adminPage.reload();
            await loginPage.expectVisible();
            await expect(adminPage).toHaveURL(/\/login/);
        } finally {
            await context.close();
            await cleanupAdministrator(client, administrator);
        }
    });

    test('does not report missing channel access when the current user cannot be loaded', async ({
        browser,
    }) => {
        const { context, page: adminPage, loginPage } = await newLoginPage(browser);
        try {
            const refetch = await failFirstCurrentUserRefetch(adminPage);
            await loginPage.goto();
            await loginPage.login('superadmin', 'superadmin');

            await expect(adminPage).not.toHaveURL(/\/login/, { timeout: 15_000 });
            expect(refetch.failedRefetch).toBe(true);
            await expect(
                adminPage
                    .locator('[data-sonner-toast]')
                    .filter({ hasText: 'You do not have access to any channel' }),
            ).toHaveCount(0);
        } finally {
            await context.close();
        }
    });

    test('shows an error and the login form when the current user cannot be loaded after logging in', async ({
        page,
        browser,
    }) => {
        const client = new VendureAdminClient(page);
        await client.login();
        const administrator = await createAdministrator(client, []);
        const { context, page: adminPage, loginPage } = await newLoginPage(browser);
        try {
            const refetch = await failFirstCurrentUserRefetch(adminPage);
            await loginPage.goto();
            await loginPage.login(administrator.emailAddress, password);

            await expect(
                adminPage
                    .locator('[data-sonner-toast]')
                    .filter({ hasText: 'You do not have access to any channel' }),
            ).toBeVisible({ timeout: 10_000 });
            await loginPage.expectVisible();
            expect(refetch.failedRefetch).toBe(true);
        } finally {
            await context.close();
            await cleanupAdministrator(client, administrator);
        }
    });
});

// #5623 — after a logout, the next user's navigation should match their permissions without a reload
test.describe('Switching user', () => {
    test('shows the navigation of a user whose role is on another channel', async ({ page, browser }) => {
        const suffix = `${Date.now()}-${Math.round(Math.random() * 1000)}`;
        const firstEmailAddress = `switch-first-user-${suffix}@test.com`;
        const emailAddress = `switch-user-${suffix}@test.com`;
        const password = 'test-password';
        const client = new VendureAdminClient(page);
        await client.login();
        // Logging out ends all sessions of a User, so a separate administrator is logged out
        // instead of the SuperAdmin which the other tests use. Its role is on the default
        // channel rather than the SuperAdmin role: the SuperAdmin role gains every channel
        // which a parallel test creates, and then this client's session may not grant it.
        const { activeChannel } = await client.gql(`query { activeChannel { id } }`);
        const { zones } = await client.gql(
            `query { zones(options: { filter: { name: { eq: "Europe" } } }) { items { id } } }`,
        );
        const zoneId = zones.items[0]?.id as string;
        expect(zoneId).toBeTruthy();
        const { createChannel } = await client.gql(
            `mutation ($input: CreateChannelInput!) {
                createChannel(input: $input) {
                    ... on Channel { id }
                    ... on ErrorResult { errorCode message }
                }
            }`,
            {
                input: {
                    code: `switch-user-${suffix}`,
                    token: `switch-user-${suffix}`,
                    defaultLanguageCode: 'en',
                    pricesIncludeTax: false,
                    defaultCurrencyCode: 'USD',
                    availableCurrencyCodes: ['USD'],
                    defaultTaxZoneId: zoneId,
                    defaultShippingZoneId: zoneId,
                },
            },
        );
        const channelId = createChannel.id as string;
        expect(channelId).toBeTruthy();
        const roleIds: string[] = [];
        const administratorIds: string[] = [];
        const createAdministrator = async (
            code: string,
            lastName: string,
            administratorEmailAddress: string,
            roleChannelId: string,
        ) => {
            const { createRole } = await client.gql(
                `mutation ($input: CreateRoleInput!) { createRole(input: $input) { id } }`,
                {
                    input: {
                        code,
                        description: 'Catalog access',
                        permissions: ['ReadCatalog'],
                        channelIds: [roleChannelId],
                    },
                },
            );
            roleIds.push(createRole.id);
            const { createAdministrator: administrator } = await client.gql(
                `mutation ($input: CreateAdministratorInput!) { createAdministrator(input: $input) { id } }`,
                {
                    input: {
                        firstName: 'Switch',
                        lastName,
                        emailAddress: administratorEmailAddress,
                        password,
                        roleIds: [createRole.id],
                    },
                },
            );
            administratorIds.push(administrator.id);
        };

        // A fresh browser context, so that the page is not signed in as the SuperAdmin
        const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
        try {
            await createAdministrator(
                `switch-first-user-${suffix}`,
                'FirstUser',
                firstEmailAddress,
                activeChannel.id,
            );
            await createAdministrator(`switch-user-${suffix}`, 'User', emailAddress, channelId);

            const userPage = await context.newPage();
            const loginPage = new LoginPage(userPage);
            await loginPage.goto();
            await loginPage.login(firstEmailAddress, password);
            await expect(userPage).not.toHaveURL(/\/login/, { timeout: 15_000 });

            await userPage
                .locator('[data-sidebar="footer"] [data-sidebar="menu-button"]')
                .filter({ hasText: 'Switch FirstUser' })
                .click();
            await userPage.getByRole('menuitem', { name: 'Log out' }).click();
            await loginPage.expectVisible();
            await loginPage.login(emailAddress, password);
            await expect(userPage).not.toHaveURL(/\/login/, { timeout: 15_000 });

            await expect(
                userPage.locator('[data-sidebar="menu-button"]').filter({ hasText: 'Catalog' }),
            ).toBeVisible({
                timeout: 10_000,
            });
        } finally {
            await context.close();
            // Remove the test data even if an assertion above failed, so that later tests
            // which reuse the e2e database do not see an extra channel
            await client
                .gql(`mutation ($ids: [ID!]!) { deleteAdministrators(ids: $ids) { result } }`, {
                    ids: administratorIds,
                })
                .catch(() => {});
            await client
                .gql(`mutation ($ids: [ID!]!) { deleteRoles(ids: $ids) { result } }`, { ids: roleIds })
                .catch(() => {});
            await client
                .gql(`mutation ($id: ID!) { deleteChannel(id: $id) { result } }`, { id: channelId })
                .catch(() => {});
        }
    });
});

// #5595 — signing in from a signed-out page must not overwrite the stored user settings
test.describe('Stored user settings on login', () => {
    const MARKER_TABLE_ID = 'e2e-5595';
    const markerTableSettings = { pageSize: 37 };

    /**
     * The e2e server has no DashboardPlugin, so the user settings store is emulated here. Each
     * request still goes to the server first, so that the server decides whether the session
     * may read the settings: without a valid session it answers FORBIDDEN, as with the plugin.
     * The emulated stored value has no `activeChannelId`, so the Dashboard writes the settings
     * back soon after the login, once it has set the active channel.
     */
    async function emulateUserSettingsStore(page: Page) {
        let storedSettings: Record<string, any> = {
            displayLanguage: 'en',
            tableSettings: { [MARKER_TABLE_ID]: markerTableSettings },
        };
        const savedValues: Array<Record<string, any>> = [];
        await page.route('**/admin-api**', async route => {
            const request = route.request().postDataJSON();
            const query: string = request?.query ?? '';
            const isRead =
                query.includes('GetSettingsStoreValue') &&
                request.variables?.key === SETTINGS_STORE_KEY_USER_SETTINGS;
            const isWrite =
                query.includes('SetSettingsStoreValue') &&
                request.variables?.input?.key === SETTINGS_STORE_KEY_USER_SETTINGS;
            if (!isRead && !isWrite) {
                await route.fallback();
                return;
            }
            const response = await route.fetch();
            const json = await response.json();
            if (json.errors?.some((e: any) => e.extensions?.code === 'FORBIDDEN')) {
                await route.fulfill({ response });
                return;
            }
            if (isWrite) {
                storedSettings = request.variables.input.value;
                savedValues.push(storedSettings);
            }
            await route.fulfill({
                response,
                json: isRead
                    ? { data: { getSettingsStoreValue: storedSettings } }
                    : {
                          data: {
                              setSettingsStoreValue: {
                                  key: SETTINGS_STORE_KEY_USER_SETTINGS,
                                  result: true,
                                  error: null,
                              },
                          },
                      },
            });
        });
        return savedValues;
    }

    async function expectStoredSettingsKept(page: Page, savedValues: Array<Record<string, any>>) {
        // Wait for the write which follows the login, then check that it kept the stored value
        await expect.poll(() => savedValues.length, { timeout: 15_000 }).toBeGreaterThan(0);
        for (const value of savedValues) {
            expect(value.tableSettings?.[MARKER_TABLE_ID]).toEqual(markerTableSettings);
        }
        // The stored value is applied in the browser, too
        const localSettings = await page.evaluate(
            key => JSON.parse(localStorage.getItem(key) ?? '{}'),
            LS_KEY_USER_SETTINGS,
        );
        expect(localSettings.tableSettings?.[MARKER_TABLE_ID]).toEqual(markerTableSettings);
    }

    test('keeps the stored settings when signing in from a fresh browser', async ({ page }) => {
        const savedValues = await emulateUserSettingsStore(page);
        const loginPage = new LoginPage(page);
        await loginPage.goto();
        await loginPage.expectVisible();
        await loginPage.login('superadmin', 'superadmin');
        await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

        await expectStoredSettingsKept(page, savedValues);
    });

    test('keeps the stored settings when signing in after the session token expired', async ({ page }) => {
        const savedValues = await emulateUserSettingsStore(page);
        const loginPage = new LoginPage(page);
        await loginPage.goto();
        // A session token which the server no longer accepts, as after the session expired
        await page.evaluate(key => localStorage.setItem(key, 'expired-session-token'), LS_KEY_SESSION_TOKEN);
        await page.goto('/products');
        await expect(page).toHaveURL(/\/login/);
        await loginPage.expectVisible();
        await loginPage.login('superadmin', 'superadmin');
        await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

        await expectStoredSettingsKept(page, savedValues);
    });
});

// #1116 — administrators should be able to reset a forgotten password
test.describe('Password reset', () => {
    test('login page links to the forgot password page', async ({ page }) => {
        const loginPage = new LoginPage(page);
        await loginPage.goto();
        await page.getByRole('link', { name: 'Forgot password?' }).click();
        await expect(page).toHaveURL(/\/forgot-password/);
    });

    test('forgot password form shows confirmation after submitting', async ({ page }) => {
        await page.goto('/forgot-password');
        await page.getByPlaceholder('Email').fill('unknown-admin@test.com');
        await page.getByRole('button', { name: 'Send reset link' }).click();
        // A confirmation is shown regardless of whether the email address exists,
        // to avoid leaking which accounts exist
        await expect(page.getByText('Check your email')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Back to sign in' })).toBeVisible();
    });

    test('reset password page without a token shows invalid link message', async ({ page }) => {
        await page.goto('/reset-password');
        await expect(page.getByText('This link is invalid or has expired')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Request a new link' })).toBeVisible();
    });

    test('reset password shows error when passwords do not match', async ({ page }) => {
        await page.goto('/reset-password?token=some-token');
        await page.getByPlaceholder('New password', { exact: true }).fill('new-password-123');
        await page.getByPlaceholder('Confirm new password').fill('different-password');
        await page.getByRole('button', { name: 'Reset password' }).click();
        await expect(page.getByText('Passwords do not match')).toBeVisible();
    });

    test('reset password with an invalid token shows invalid link message', async ({ page }) => {
        await page.goto('/reset-password?token=invalid-token');
        await page.getByPlaceholder('New password', { exact: true }).fill('new-password-123');
        await page.getByPlaceholder('Confirm new password').fill('new-password-123');
        await page.getByRole('button', { name: 'Reset password' }).click();
        await expect(page.getByText('This link is invalid or has expired')).toBeVisible();
    });
});
