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

test.describe('Address form country dropdown', () => {
    let customerId = '';

    test.afterEach(async ({ page }) => {
        if (!customerId) {
            return;
        }
        const client = new VendureAdminClient(page);
        await client.login();
        await client.gql(`mutation DeleteCustomer($id: ID!) { deleteCustomer(id: $id) { result } }`, {
            id: customerId,
        });
        customerId = '';
    });

    test('should pre-select an existing address country when editing', async ({ page }) => {
        const client = new VendureAdminClient(page);
        await client.login();
        const suffix = Date.now();
        const customerResult = await client.gql(
            `mutation CreateCustomer($input: CreateCustomerInput!) {
                createCustomer(input: $input) {
                    ... on Customer { id }
                    ... on ErrorResult { errorCode message }
                }
            }`,
            {
                input: {
                    firstName: 'Country',
                    lastName: 'Preselection',
                    emailAddress: `country-preselection-${suffix}@example.com`,
                },
            },
        );
        customerId = customerResult.createCustomer.id;
        expect(customerId).toBeTruthy();

        await client.gql(
            `mutation CreateCustomerAddress($customerId: ID!, $input: CreateAddressInput!) {
                createCustomerAddress(customerId: $customerId, input: $input) { id }
            }`,
            {
                customerId,
                input: {
                    fullName: 'Country Preselection',
                    streetLine1: '123 Main Street',
                    city: 'New York',
                    countryCode: 'US',
                },
            },
        );

        await page.goto(`/customers/${customerId}`);
        await expect(page.getByRole('heading', { name: 'Country Preselection' })).toBeVisible();
        const addressCard = page.getByText('123 Main Street').locator('..').locator('..');
        await addressCard.getByRole('button').first().click();

        const countrySelect = page.getByRole('dialog', { name: 'Edit Address' }).getByRole('combobox');
        await expect(countrySelect).toContainText('United States of America');
    });
});
