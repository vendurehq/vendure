import { test } from '@playwright/test';

import { createCrudTestSuite } from '../../utils/crud-test-factory.js';

test.describe('Sellers', () => {
    test.describe.configure({ mode: 'serial' });

    createCrudTestSuite({
        entityName: 'seller',
        entityNamePlural: 'sellers',
        listPath: '/sellers',
        listTitle: 'Sellers',
        newButtonLabel: 'New Seller',
        newPageTitle: 'New seller',
        createFields: [{ label: 'Name', value: 'E2E Test Seller' }],
        updateFields: [{ label: 'Name', value: 'E2E Test Seller Updated' }],
        hasBulkDelete: true,
    });
});
