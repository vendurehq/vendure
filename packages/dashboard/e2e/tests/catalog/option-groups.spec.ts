import { expect, test } from '@playwright/test';

import { createCrudTestSuite } from '../../utils/crud-test-factory.js';

createCrudTestSuite({
    entityName: 'option group',
    entityNamePlural: 'option groups',
    listPath: '/option-groups',
    listTitle: 'Option Groups',
    newButtonLabel: 'New option group',
    newPageTitle: 'New option group',
    createFields: [{ label: 'Name', value: 'E2E Test Material' }],
    afterFillCreate: async (page, detail) => {
        // Click the "Edit slug manually" button to unlock the Code field,
        // then fill it explicitly. This avoids timing issues with the
        // SlugInput's async auto-generation via API + useEffect.
        const codeItem = detail.formItem('Code');
        await codeItem.getByRole('button', { name: 'Edit slug manually' }).click();
        await codeItem.getByRole('textbox').fill('e2e-test-material');
    },
});

test.describe('option groups list - options column', () => {
    // product-variants-option-groups-ux PRD (story 19) — the Options column is
    // visible by default and shows the group's option value names.
    test('shows the option value names for a group', async ({ page }) => {
        await page.goto('/option-groups');
        await expect(page.getByTestId('page-heading')).toBeVisible();

        // Narrow to the seeded "shoe size" group, which has four options.
        await page.getByRole('textbox', { name: /^Search/ }).first().fill('shoe size');

        const row = page.locator('table tbody tr').filter({ hasText: 'shoe size' }).first();
        await expect(row).toBeVisible();
        await expect(row.getByText('Size 40', { exact: true })).toBeVisible();
        await expect(row.getByText('Size 42', { exact: true })).toBeVisible();
        await expect(row.getByText('Size 44', { exact: true })).toBeVisible();
        await expect(row.getByText('Size 46', { exact: true })).toBeVisible();

        // The group has fewer options than the truncation limit, so no
        // "+ N more" indicator should appear. (No seed group has enough
        // options to trigger truncation, so the "+N more" path is not
        // exercised here.)
        await expect(row.getByText(/\+ \d+ more/)).toHaveCount(0);
    });
});
