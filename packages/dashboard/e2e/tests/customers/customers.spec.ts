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

// #5191 — the country dropdown on the customer address form must include every
// enabled country, sorted by name. The query returned countries unsorted, and
// Base UI's Select drops items whose order does not match its own collation, so
// a country whose name sorted between two existing ones was missing from the
// dropdown.
test('address form country dropdown includes a newly created country', async ({ page }) => {
    const client = new VendureAdminClient(page);
    await client.login();

    // A name that sorts in the middle of the list (between the seeded "Austria"
    // and "Canada"), which is exactly where the unsorted-order bug dropped items.
    const suffix = Date.now();
    const countryName = `Belgium E2E ${suffix}`;
    const countryCode = `QE${suffix.toString().slice(-4)}`;

    const countryResult = await client.gql(
        `mutation CreateCountryForAddressTest($input: CreateCountryInput!) {
            createCountry(input: $input) { id }
        }`,
        {
            input: {
                code: countryCode,
                enabled: true,
                translations: [{ languageCode: 'en', name: countryName }],
            },
        },
    );
    const countryId = countryResult.createCountry.id as string;
    expect(countryId).toBeTruthy();

    const customerResult = await client.gql(
        `mutation CreateCustomerForAddressTest($input: CreateCustomerInput!) {
            createCustomer(input: $input) {
                ... on Customer { id }
                ... on ErrorResult { errorCode message }
            }
        }`,
        {
            input: {
                firstName: 'Address',
                lastName: 'CountryTest',
                emailAddress: `address-country-test-${suffix}@example.com`,
            },
        },
    );
    const customerId = customerResult.createCustomer.id as string;
    expect(customerId).toBeTruthy();

    try {
        await page.goto(`/customers/${customerId}`);
        await expect(page.getByRole('heading', { name: 'Address CountryTest' })).toBeVisible();

        // Open the "Add new address" dialog and its Country select.
        await page.getByRole('button', { name: 'Add new address' }).click();
        const countryField = page.locator('[data-slot="field"]').filter({
            has: page.locator('[data-slot="field-label"]').getByText('Country', { exact: true }),
        });
        await countryField.getByRole('combobox').click();

        // The newly created country is present in the list.
        await expect(page.getByRole('option', { name: countryName })).toBeVisible({ timeout: 10_000 });

        // ...and the options are rendered in ascending name order. This is the
        // real guarantee of the fix: the query now sorts by name, so the order
        // matches Base UI's collation and no items are dropped from the popup.
        const optionLabels = await page.getByRole('option').allInnerTexts();
        const sorted = [...optionLabels].sort((a, b) => a.localeCompare(b));
        expect(optionLabels).toEqual(sorted);
    } finally {
        // Cleanup.
        await client.gql(`mutation ($id: ID!) { deleteCustomer(id: $id) { result } }`, {
            id: customerId,
        });
        await client.gql(`mutation ($id: ID!) { deleteCountry(id: $id) { result } }`, {
            id: countryId,
        });
    }
});

// #5191 (symptom 2) — editing an existing address must pre-select its country
// in the Country dropdown, rather than falling back to the placeholder.
test('editing an existing address pre-selects its country', async ({ page }) => {
    const client = new VendureAdminClient(page);
    await client.login();
    const suffix = Date.now();
    const countryName = `Belgium E2E ${suffix}`;
    const countryCode = `QE${suffix.toString().slice(-4)}`;
    const country = await client.gql(
        `mutation ($input: CreateCountryInput!) { createCountry(input: $input) { id } }`,
        { input: { code: countryCode, enabled: true, translations: [{ languageCode: 'en', name: countryName }] } },
    );
    const countryId = country.createCountry.id as string;
    const cust = await client.gql(
        `mutation ($input: CreateCustomerInput!) { createCustomer(input: $input) { ... on Customer { id } } }`,
        { input: { firstName: 'Edit', lastName: 'CountryTest', emailAddress: `edit-country-${suffix}@example.com` } },
    );
    const customerId = cust.createCustomer.id as string;
    await client.gql(
        `mutation ($customerId: ID!, $input: CreateAddressInput!) { createCustomerAddress(customerId: $customerId, input: $input) { id } }`,
        { customerId, input: { streetLine1: '1 Test St', city: 'Testville', countryCode } },
    );
    try {
        await page.goto(`/customers/${customerId}`);
        await expect(page.getByRole('heading', { name: 'Edit CountryTest' })).toBeVisible();
        await page.locator('[data-slot="dialog-trigger"]').first().click();
        const editDialog = page.getByRole('dialog').filter({ hasText: 'Edit Address' });
        await expect(editDialog).toBeVisible();
        const editCountryField = editDialog.locator('[data-slot="field"]').filter({
            has: page.locator('[data-slot="field-label"]').getByText('Country', { exact: true }),
        });
        await expect(editCountryField.getByRole('combobox')).toContainText(countryName, { timeout: 10_000 });
    } finally {
        await client.gql(`mutation ($id: ID!) { deleteCustomer(id: $id) { result } }`, { id: customerId });
        await client.gql(`mutation ($id: ID!) { deleteCountry(id: $id) { result } }`, { id: countryId });
    }
});

