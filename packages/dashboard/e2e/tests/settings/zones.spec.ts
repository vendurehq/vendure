import { test } from '@playwright/test';

import { createCrudTestSuite } from '../../utils/crud-test-factory.js';

test.describe('Zones', () => {
    test.describe.configure({ mode: 'serial' });

    createCrudTestSuite({
        entityName: 'zone',
        entityNamePlural: 'zones',
        listPath: '/zones',
        listTitle: 'Zones',
        newButtonLabel: 'New Zone',
        newPageTitle: 'New zone',
        createFields: [{ label: 'Name', value: 'E2E Test Zone' }],
        updateFields: [{ label: 'Name', value: 'E2E Test Zone Updated' }],
        hasSearch: false,
        hasBulkDelete: true,
    });
});
