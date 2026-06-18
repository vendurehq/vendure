import { test } from '@playwright/test';

import { createCrudTestSuite } from '../../utils/crud-test-factory.js';

test.describe('Tax Rates', () => {
    test.describe.configure({ mode: 'serial' });

    createCrudTestSuite({
        entityName: 'tax rate',
        entityNamePlural: 'tax rates',
        listPath: '/tax-rates',
        listTitle: 'Tax Rates',
        newButtonLabel: 'New Tax Rate',
        newPageTitle: 'New tax rate',
        createFields: [
            { label: 'Name', value: 'E2E Test Rate' },
            { label: 'Rate', value: '15', type: 'number' },
            { label: 'Tax category', value: 'Standard Tax', type: 'select' },
            { label: 'Zone', value: 'Europe', type: 'select' },
        ],
        updateFields: [
            { label: 'Name', value: 'E2E Test Rate Updated' },
            { label: 'Rate', value: '25', type: 'number' },
        ],
        hasBulkDelete: true,
    });
});
