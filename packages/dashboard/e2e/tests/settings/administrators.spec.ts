import { type Browser, type Page, expect, test } from '@playwright/test';

import { BaseDetailPage } from '../../page-objects/detail-page.base.js';
import { BaseListPage } from '../../page-objects/list-page.base.js';
import { expectPopupClosed, expectPopupOpen } from '../../utils/base-ui-popups.js';
import { VendureAdminClient } from '../../utils/vendure-admin-client.js';

// Administrators have a password field and a role assignment builder
// that don't fit the standard CRUD factory, so we use custom tests.

test.describe('Administrators', () => {
    test.describe.configure({ mode: 'serial' });

    const listPage = (page: Page) =>
        new BaseListPage(page, {
            path: '/administrators',
            title: 'Administrators',
            newButtonLabel: 'New Administrator',
        });

    const detailPage = (page: Page) =>
        new BaseDetailPage(page, {
            newPath: '/administrators/new',
            pathPrefix: '/administrators/',
            newTitle: 'New administrator',
        });

    test('should display the administrators list page', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
    });

    test('should show the superadmin', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await expect(lp.getRows().filter({ hasText: 'Super Admin' }).first()).toBeVisible();
    });

    test('should navigate to administrator detail', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await lp.clickEntity('Super Admin');
        await expect(page).toHaveURL(/\/administrators\/[^/]+$/);
    });

    test('should create a new administrator', async ({ page }) => {
        const dp = detailPage(page);
        await dp.gotoNew();
        await dp.expectNewPageLoaded();

        await dp.fillInput('First name', 'Test');
        await dp.fillInput('Last name', 'Admin');
        await dp.fillInput('Email Address or identifier', 'test-admin@example.com');
        await dp.fillPassword('Password', 'test123456');

        // The role assignment editor starts with one row on the active channel,
        // so only the role itself needs picking
        // The role picker is a single select, which closes itself on selection
        const roleCombobox = page.getByRole('combobox').first();
        await roleCombobox.click();
        await page.getByRole('option', { name: 'SuperAdmin', exact: true }).click();
        await expectPopupClosed(roleCombobox);

        await dp.clickCreate();
        await dp.expectSuccessToast(/Successfully created administrator/);
        await dp.expectNavigatedToExisting();
    });

    test('should find the created administrator in the list', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await expect(lp.getRows().filter({ hasText: 'Test Admin' }).first()).toBeVisible();
    });

    test('should navigate to administrator detail page', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await lp.clickEntity('Test Admin');
        await expect(page).toHaveURL(/\/administrators\/[^/]+$/);
    });

    test('should update the administrator', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await lp.clickEntity('Test Admin');
        await expect(page).toHaveURL(/\/administrators\/[^/]+$/);

        const dp = detailPage(page);
        await dp.fillInput('First name', 'Updated');
        await dp.clickUpdate();
        await dp.expectSuccessToast(/Successfully updated administrator/);
    });

    test('should show updated name in the list', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await expect(lp.getRows().filter({ hasText: 'Updated Admin' }).first()).toBeVisible();
    });

    test('should bulk-delete administrators', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();

        // Select the test admin row (not the first row which is the superadmin)
        const testAdminRow = lp.getRows().filter({ hasText: 'Updated Admin' });
        await testAdminRow.getByRole('checkbox').click();
        await page.getByRole('button', { name: /Actions/i }).click();
        await page.locator('[role="menu"]').getByText('Delete', { exact: true }).click();
        await page.locator('[role="alertdialog"]').getByRole('button', { name: 'Continue' }).click();
        await lp.expectSuccessToast();

        // Verify the admin is gone
        await expect(lp.getRows().filter({ hasText: 'Updated Admin' })).toHaveCount(0);
    });
});

// Role assignments at marketplace scale: an administrator holding one role on many channels,
// and an instance with more than 100 roles.
test.describe('Administrator role assignments at scale', () => {
    test.describe.configure({ mode: 'serial' });

    const CHANNEL_COUNT = 14;
    const suffix = `${Date.now()}-${Math.round(Math.random() * 1000)}`;
    const roleDescription = `E2E many-channel role ${suffix}`;
    const channelCodes = Array.from(
        { length: CHANNEL_COUNT },
        (_, i) => `scale-${suffix}-${String(i + 1).padStart(2, '0')}`,
    );
    const created = { channelIds: [] as string[], roleIds: [] as string[], administratorId: '' };

    async function adminClient(browser: Browser) {
        const context = await browser.newContext();
        const client = new VendureAdminClient(await context.newPage());
        await client.login();
        return { client, context };
    }

    test.beforeAll(async ({ browser }) => {
        const { client, context } = await adminClient(browser);
        const { zones } = await client.gql(
            `query { zones(options: { filter: { name: { eq: "Europe" } } }) { items { id } } }`,
        );
        const zoneId = zones.items[0].id as string;
        for (const code of channelCodes) {
            const { createChannel } = await client.gql(
                `mutation ($input: CreateChannelInput!) {
                    createChannel(input: $input) { ... on Channel { id } ... on ErrorResult { message } }
                }`,
                {
                    input: {
                        code,
                        token: code,
                        defaultLanguageCode: 'en',
                        pricesIncludeTax: false,
                        defaultCurrencyCode: 'USD',
                        availableCurrencyCodes: ['USD'],
                        defaultTaxZoneId: zoneId,
                        defaultShippingZoneId: zoneId,
                    },
                },
            );
            created.channelIds.push(createChannel.id);
        }
        // A shared role (created on the default channel), so it can be granted on every channel
        const { createRole } = await client.gql(
            `mutation ($input: CreateRoleInput!) { createRole(input: $input) { id } }`,
            {
                input: {
                    code: `e2e-many-channels-${suffix}`,
                    description: roleDescription,
                    permissions: ['ReadCatalog'],
                },
            },
        );
        created.roleIds.push(createRole.id);
        const { createAdministrator } = await client.gql(
            `mutation ($input: CreateAdministratorInput!) { createAdministrator(input: $input) { id } }`,
            {
                input: {
                    firstName: 'Scale',
                    lastName: suffix,
                    emailAddress: `scale-${suffix}@test.com`,
                    password: 'test-password',
                    roleAssignments: created.channelIds.map(channelId => ({
                        roleId: createRole.id,
                        channelId,
                    })),
                },
            },
        );
        created.administratorId = createAdministrator.id;
        await context.close();
    });

    test.afterAll(async ({ browser }) => {
        const { client, context } = await adminClient(browser);
        if (created.administratorId) {
            await client.gql(`mutation ($ids: [ID!]!) { deleteAdministrators(ids: $ids) { result } }`, {
                ids: [created.administratorId],
            });
        }
        if (created.roleIds.length) {
            await client.gql(`mutation ($ids: [ID!]!) { deleteRoles(ids: $ids) { result } }`, {
                ids: created.roleIds,
            });
        }
        if (created.channelIds.length) {
            await client.gql(`mutation ($ids: [ID!]!) { deleteChannels(ids: $ids) { result } }`, {
                ids: created.channelIds,
            });
        }
        await context.close();
    });

    const roleRow = (page: Page) =>
        page.getByTestId('role-assignment-row').filter({ hasText: roleDescription });

    test('shows a role held on many channels as one row with collapsible channels', async ({ page }) => {
        await page.goto(`/administrators/${created.administratorId}`);
        const row = roleRow(page);
        await expect(row).toHaveCount(1);
        await expect(row).toContainText(`${CHANNEL_COUNT} channels`);
        // 12 chips are shown, the rest collapse
        await expect(row.getByText(channelCodes[CHANNEL_COUNT - 1])).toHaveCount(0);
        await row.getByRole('button', { name: '+2 more' }).click();
        await expect(row.getByText(channelCodes[CHANNEL_COUNT - 1])).toBeVisible();
    });

    test('filters the assignments by channel', async ({ page }) => {
        await page.goto(`/administrators/${created.administratorId}`);
        await page.getByRole('textbox', { name: 'Filter role assignments' }).fill(channelCodes[4]);
        const row = roleRow(page);
        await expect(row).toContainText(`1 of ${CHANNEL_COUNT} channels`);
        await expect(row.getByText(channelCodes[4])).toBeVisible();
        await expect(row.getByText(channelCodes[5])).toHaveCount(0);
    });

    test('shows the effective permissions of a channel clicked in the table', async ({ page }) => {
        await page.goto(`/administrators/${created.administratorId}`);
        await roleRow(page).getByRole('button', { name: channelCodes[2], exact: true }).click();
        await expect(page.getByRole('combobox', { name: 'Select items' })).toHaveValue(channelCodes[2]);
    });

    test('selects every grantable channel in one step', async ({ page }) => {
        await page.goto(`/administrators/${created.administratorId}`);
        // The assign row is hidden until "Add role" is clicked, and Cancel hides it again
        await expect(page.getByRole('combobox', { name: 'Select a role' })).toHaveCount(0);
        await page.getByRole('button', { name: 'Add role', exact: true }).click();
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(page.getByRole('combobox', { name: 'Select a role' })).toHaveCount(0);
        await page.getByRole('button', { name: 'Add role', exact: true }).click();
        const selectAll = page.getByRole('button', { name: /^Select all \(\d+\)$/ });
        await selectAll.click();
        // Selecting every channel collapses the chips in the picker
        await expect(page.getByRole('button', { name: /^\+\d+ more$/ }).last()).toBeVisible();
        await expect(selectAll).toHaveCount(0);
        await page.getByRole('button', { name: 'Clear', exact: true }).click();
        await expect(page.getByRole('combobox', { name: 'Select a channel' })).toBeVisible();
    });

    test('filters the channel switcher', async ({ page }) => {
        await page.goto(`/administrators/${created.administratorId}`);
        const sidebar = page.locator('[data-slot="sidebar"]');
        await sidebar.getByRole('button').first().click();
        const switcherMenu = page.locator('[data-slot="dropdown-menu-content"]');
        await expect(switcherMenu).toBeVisible();
        await switcherMenu.getByRole('textbox', { name: 'Filter channels' }).fill(channelCodes[7]);
        await expect(switcherMenu.getByRole('menuitem', { name: channelCodes[7] })).toBeVisible();
        await expect(switcherMenu.getByRole('menuitem', { name: channelCodes[8] })).toHaveCount(0);
    });

    test('offers a role beyond the first 100 in the role picker', async ({ page, browser }) => {
        const { client, context } = await adminClient(browser);
        const { roles } = await client.gql(`query { roles(options: { take: 1 }) { totalItems } }`);
        const missing = Math.max(0, 101 - (roles.totalItems as number));
        let lastDescription = '';
        for (let i = 0; i <= missing; i++) {
            lastDescription = `E2E extra role ${suffix} ${i}`;
            const { createRole } = await client.gql(
                `mutation ($input: CreateRoleInput!) { createRole(input: $input) { id } }`,
                {
                    input: {
                        code: `e2e-extra-${suffix}-${i}`,
                        description: lastDescription,
                        permissions: ['ReadCatalog'],
                    },
                },
            );
            created.roleIds.push(createRole.id);
        }
        await context.close();

        await page.goto(`/administrators/${created.administratorId}`);
        await page.getByRole('button', { name: 'Add role', exact: true }).click();
        const roleCombobox = page.getByRole('combobox', { name: 'Select a role' });
        await roleCombobox.click();
        await expectPopupOpen(roleCombobox);
        await roleCombobox.fill(lastDescription);
        await expect(page.getByRole('option', { name: lastDescription, exact: true })).toBeVisible();
    });

    test('removes a role from all its channels after confirmation', async ({ page }) => {
        await page.goto(`/administrators/${created.administratorId}`);
        await roleRow(page).getByRole('button', { name: 'Remove from all channels' }).click();
        await page
            .locator('[role="alertdialog"]')
            .getByRole('button', { name: 'Remove', exact: true })
            .click();
        await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Role removed' })).toBeVisible();
        await expect(roleRow(page)).toHaveCount(0);
    });
});
