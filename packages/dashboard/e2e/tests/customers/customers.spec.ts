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
