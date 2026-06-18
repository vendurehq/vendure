import { test } from '@playwright/test';

import { createCrudTestSuite } from '../../utils/crud-test-factory.js';

test.describe('Countries', () => {
    test.describe.configure({ mode: 'serial' });

    createCrudTestSuite({
        entityName: 'country',
        entityNamePlural: 'countries',
        listPath: '/countries',
        listTitle: 'Countries',
        newButtonLabel: 'Add Country',
        newPageTitle: 'New country',
        createFields: [
            { label: 'Name', value: 'E2E Testland' },
            { label: 'Code', value: 'E2' },
            { label: 'Enabled', value: true, type: 'switch' },
        ],
        updateFields: [
            { label: 'Name', value: 'E2E Testland Updated' },
            { label: 'Code', value: 'EU' },
        ],
        hasBulkDelete: true,
    });
});
