import { test } from '@playwright/test';

import { createCrudTestSuite } from '../../utils/crud-test-factory.js';

test.describe('Customer Groups', () => {
    test.describe.configure({ mode: 'serial' });

    createCrudTestSuite({
        entityName: 'customer group',
        entityNamePlural: 'customer groups',
        listPath: '/customer-groups',
        listTitle: 'Customer Groups',
        newButtonLabel: 'New Customer Group',
        newPageTitle: 'New customer group',
        createFields: [{ label: 'Name', value: 'E2E Test Group' }],
        updateFields: [{ label: 'Name', value: 'E2E Test Group Updated' }],
        hasBulkDelete: true,
    });
});
