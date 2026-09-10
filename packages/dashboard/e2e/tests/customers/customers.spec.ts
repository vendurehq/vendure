import { type Page, expect, test } from '@playwright/test';

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
    let countryId = '';

    async function createCustomerWithUsAddress(client: VendureAdminClient, name: string) {
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
                    lastName: name,
                    emailAddress: `country-${name.toLowerCase()}-${suffix}@example.com`,
                },
            },
        );
        if (!('id' in customerResult.createCustomer)) {
            throw new Error(customerResult.createCustomer.message);
        }
        customerId = customerResult.createCustomer.id;

        await client.gql(
            `mutation CreateCustomerAddress($customerId: ID!, $input: CreateAddressInput!) {
                createCustomerAddress(customerId: $customerId, input: $input) { id }
            }`,
            {
                customerId,
                input: {
                    fullName: `Country ${name}`,
                    streetLine1: '123 Main Street',
                    city: 'New York',
                    countryCode: 'US',
                },
            },
        );
    }

    async function openAddressCountrySelect(page: Page) {
        await page.goto(`/customers/${customerId}`);
        await page.getByRole('button', { name: 'Edit Address' }).click();
        return page.getByRole('dialog', { name: 'Edit Address' }).getByRole('combobox', { name: 'Country' });
    }

    test.afterEach(async ({ page }) => {
        const client = new VendureAdminClient(page);
        await client.login();
        if (customerId) {
            await client.gql(`mutation DeleteCustomer($id: ID!) { deleteCustomer(id: $id) { result } }`, {
                id: customerId,
            });
            customerId = '';
        }
        if (countryId) {
            await client.gql(`mutation DeleteCountry($id: ID!) { deleteCountry(id: $id) { result } }`, {
                id: countryId,
            });
            countryId = '';
        }
    });

    // #5191 — saved address countries must display in the customer address form
    test('should pre-select an existing address country when editing', async ({ page }) => {
        const client = new VendureAdminClient(page);
        await client.login();
        await createCustomerWithUsAddress(client, 'Preselection');

        const countrySelect = await openAddressCountrySelect(page);

        await expect(countrySelect).toContainText('United States of America');
    });

    // #5191 — the dropdown must list countries by name, so a country created after
    // the others is still found where someone scanning the list expects it
    test('should list countries in name order, including a newly created one', async ({ page }) => {
        const client = new VendureAdminClient(page);
        await client.login();
        // "Belgium" sorts between the seeded "Austria" and "Canada", so name order
        // puts it third while insertion order puts it last.
        const created = await client.gql(
            `mutation CreateCountry($input: CreateCountryInput!) {
                createCountry(input: $input) { id }
            }`,
            {
                input: {
                    code: 'BE',
                    enabled: true,
                    translations: [{ languageCode: 'en', name: 'Belgium' }],
                },
            },
        );
        countryId = created.createCountry.id;
        await createCustomerWithUsAddress(client, 'Ordering');

        const countrySelect = await openAddressCountrySelect(page);
        await countrySelect.click();

        const optionNames = await page.getByRole('option').allInnerTexts();
        expect(optionNames).toContain('Belgium');
        expect(optionNames).toEqual([...optionNames].sort((a, b) => a.localeCompare(b)));
    });
});
