import { expect, test } from '@playwright/test';

import { createCrudTestSuite } from '../../utils/crud-test-factory.js';
import { VendureAdminClient } from '../../utils/vendure-admin-client.js';

createCrudTestSuite({
    entityName: 'customer',
    entityNamePlural: 'customers',
    listPath: '/customers',
    listTitle: 'Customers',
    newButtonLabel: 'New Customer',
    newPageTitle: 'New customer',
    createFields: [
        { label: 'First name', value: 'E2E' },
        { label: 'Last name', value: 'TestCustomer' },
        { label: 'Email address', value: 'e2e-test-customer@example.com' },
    ],
    searchTerm: 'TestCustomer',
    updateFields: [{ label: 'Last name', value: 'TestCustomerUpdated' }],
});

// #4997 — the history timeline must refresh after updating the customer,
// without requiring a full page reload
test('should show new history entries after updating the customer', async ({ page }) => {
    const client = new VendureAdminClient(page);
    await client.login();
    const result = await client.gql(
        `mutation CreateCustomerForHistoryTest($input: CreateCustomerInput!) {
            createCustomer(input: $input) {
                ... on Customer { id }
                ... on ErrorResult { errorCode message }
            }
        }`,
        {
            input: {
                firstName: 'History',
                lastName: 'RefreshTest',
                emailAddress: `history-refresh-test-${Date.now()}@example.com`,
            },
        },
    );
    const customerId = result.createCustomer.id;
    expect(customerId).toBeTruthy();

    await page.goto(`/customers/${customerId}`);
    await expect(page.getByRole('heading', { name: 'History RefreshTest' })).toBeVisible();
    await expect(page.getByText('Customer details updated')).toHaveCount(0);

    await page.getByLabel('Last name').fill('RefreshTestUpdated');
    await page.getByRole('button', { name: 'Update' }).click();
    await expect(page.getByText('Successfully updated customer')).toBeVisible();

    await expect(page.getByText('Customer details updated').first()).toBeVisible();
});

// discussions/4756 — an admin-created customer has no password, so the verify dialog has to say
// so rather than silently verifying an account nobody can log into
test('should report a missing password inline, then verify the account', async ({ page }) => {
    const client = new VendureAdminClient(page);
    await client.login();
    const result = await client.gql(
        `mutation CreateCustomerForVerifyTest($input: CreateCustomerInput!) {
            createCustomer(input: $input) {
                __typename
                ... on Customer { id }
                ... on ErrorResult { errorCode message }
            }
        }`,
        {
            input: {
                firstName: 'Verify',
                lastName: 'DialogTest',
                emailAddress: `verify-dialog-test-${Date.now()}@example.com`,
            },
        },
    );
    expect(result.createCustomer.__typename).toBe('Customer');
    const customerId = result.createCustomer.id;

    await page.goto(`/customers/${customerId}`);
    await page.getByRole('button', { name: 'Verify account' }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Verify', exact: true }).click();
    await expect(page.getByTestId('verify-account-error')).toContainText('password must be provided');

    await dialog.getByLabel('Password').fill('test-password');
    await dialog.getByRole('button', { name: 'Verify', exact: true }).click();

    await expect(page.getByText('Customer account verified')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Verify account' })).toHaveCount(0);
});

// discussions/4756 — the create form's password field goes to the `createCustomer(password:)`
// argument rather than into CreateCustomerInput, and verifies the account on the way
test('should create a customer with a password, verified on creation', async ({ page }) => {
    const client = new VendureAdminClient(page);
    await client.login();
    const emailAddress = `create-with-password-${Date.now()}@example.com`;

    await page.goto('/customers/new');
    await page.getByLabel('First name').fill('Password');
    await page.getByLabel('Last name').fill('OnCreate');
    await page.getByLabel('Email address').fill(emailAddress);
    await page.getByLabel('Password', { exact: true }).fill('test-password');
    await page.getByRole('button', { name: 'Create' }).click();

    await expect(page.getByText('Successfully created customer')).toBeVisible();
    // Wait for the detail page of the new customer before reading its status, so the assertions
    // below cannot pass against a page which has not rendered yet.
    await expect(page.getByRole('heading', { name: 'Password OnCreate' })).toBeVisible();
    await expect(page.getByText('Verified', { exact: true })).toBeVisible();
    // Verified already, so the action for verifying it is not offered.
    await expect(page.getByRole('button', { name: 'Verify account' })).toHaveCount(0);
});

// discussions/4756 — a password the server's validation strategy rejects must say why, rather
// than failing silently now that createCustomer returns PasswordValidationError
test('should report a rejected password when creating a customer', async ({ page }) => {
    const client = new VendureAdminClient(page);
    await client.login();

    await page.goto('/customers/new');
    await page.getByLabel('First name').fill('Weak');
    await page.getByLabel('Last name').fill('Password');
    await page.getByLabel('Email address').fill(`weak-password-${Date.now()}@example.com`);
    await page.getByLabel('Password', { exact: true }).fill('ab');
    await page.getByRole('button', { name: 'Create' }).click();

    await expect(page.getByText('Failed to create customer')).toBeVisible();
    // The description, not just the title, so the test fails if the server's reason stops being
    // surfaced. The default PasswordValidationStrategy reports no policy of its own, so this is
    // the generic message; a strategy which returns a string puts that in `validationErrorMessage`.
    await expect(page.getByText('Password is invalid')).toBeVisible();
});
