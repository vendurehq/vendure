import { test } from '@playwright/test';

import { createCrudTestSuite } from '../../utils/crud-test-factory.js';

test.describe('Stock Locations', () => {
    test.describe.configure({ mode: 'serial' });

    createCrudTestSuite({
        entityName: 'stock location',
        entityNamePlural: 'stock locations',
        listPath: '/stock-locations',
        listTitle: 'Stock Locations',
        newButtonLabel: 'New Stock Location',
        newPageTitle: 'New stock location',
        createFields: [
            { label: 'Name', value: 'E2E Test Warehouse' },
            { label: 'Description', value: 'A test warehouse for e2e testing' },
        ],
        updateFields: [
            { label: 'Name', value: 'E2E Test Warehouse Updated' },
            { label: 'Description', value: 'Updated test warehouse description' },
        ],
        hasBulkDelete: true,
    });
});
