import { expect, test } from '@playwright/test';

import { BaseDetailPage } from '../../page-objects/detail-page.base.js';
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

    test('should create a tax rate that applies to a country', async ({ page }) => {
        const detail = new BaseDetailPage(page, {
            newPath: '/tax-rates/new',
            pathPrefix: '/tax-rates/',
            newTitle: 'New tax rate',
        });
        await detail.gotoNew();
        await detail.expectNewPageLoaded();
        await detail.fillFields([
            { label: 'Name', value: 'E2E Country Rate' },
            { label: 'Rate', value: '19', type: 'number' },
            { label: 'Tax category', value: 'Standard Tax', type: 'select' },
            { label: 'Applies to', value: 'Country', type: 'select' },
            { label: 'Country', value: 'Australia', type: 'select' },
        ]);
        await detail.clickCreate();
        await detail.expectSuccessToast(/created/i);
        await detail.expectNavigatedToExisting();
    });

    test('should only allow saving a tax rate with a zone or a country', async ({ page }) => {
        const detail = new BaseDetailPage(page, {
            newPath: '/tax-rates/new',
            pathPrefix: '/tax-rates/',
            newTitle: 'New tax rate',
        });
        await detail.gotoNew();
        await detail.expectNewPageLoaded();
        await detail.fillFields([
            { label: 'Name', value: 'E2E No Target Rate' },
            { label: 'Rate', value: '7', type: 'number' },
            { label: 'Tax category', value: 'Standard Tax', type: 'select' },
            { label: 'Applies to', value: 'Country', type: 'select' },
        ]);
        const createButton = page.getByRole('button', { name: 'Create', exact: true });
        await expect(createButton).toBeDisabled();
        await detail.fillFields([{ label: 'Country', value: 'Australia', type: 'select' }]);
        await expect(createButton).toBeEnabled();
    });
});
