import { test } from '@playwright/test';

import { createCrudTestSuite } from '../../utils/crud-test-factory.js';

test.describe('Tax Categories', () => {
    // Tests run sequentially within the describe block because later
    // tests depend on entities created by earlier tests (e.g. update
    // relies on the entity created in the create test).
    test.describe.configure({ mode: 'serial' });

    createCrudTestSuite({
        entityName: 'tax category',
        entityNamePlural: 'tax categories',
        listPath: '/tax-categories',
        listTitle: 'Tax Categories',
        newButtonLabel: 'New Tax Category',
        newPageTitle: 'New tax category',
        createFields: [{ label: 'Name', value: 'E2E Test Tax' }],
        updateFields: [{ label: 'Name', value: 'E2E Test Tax Updated' }],
        hasBulkDelete: true,
    });
});
