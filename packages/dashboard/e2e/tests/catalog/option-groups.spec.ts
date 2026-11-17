import { expect, test } from '@playwright/test';

import { createCrudTestSuite } from '../../utils/crud-test-factory.js';
import { VendureAdminClient } from '../../utils/vendure-admin-client.js';

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
        // "+ N more" indicator should appear.
        await expect(row.getByText(/\+ \d+ more/)).toHaveCount(0);
    });

    // product-variants-option-groups-ux PRD (story 19) — a group with more
    // options than the display limit (5) is truncated to the first 5 option
    // badges plus a "+ N more" indicator for the remainder. No seeded group
    // has enough options, so one is created via the admin API for this test.
    test('truncates the options column with a "+N more" indicator', async ({ page }) => {
        const client = new VendureAdminClient(page);
        await client.login();

        const suffix = Date.now();
        const groupName = `E2E Truncation Group ${suffix}`;
        const optionLabels = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
        await client.gql(
            `mutation ($input: CreateProductOptionGroupInput!) {
                createProductOptionGroup(input: $input) { id }
            }`,
            {
                input: {
                    code: `e2e-truncation-group-${suffix}`,
                    translations: [{ languageCode: 'en', name: groupName }],
                    options: optionLabels.map(label => ({
                        code: `e2e-trunc-${label.toLowerCase()}-${suffix}`,
                        translations: [{ languageCode: 'en', name: `Trunc ${label}` }],
                    })),
                },
            },
        );

        await page.goto('/option-groups');
        await expect(page.getByTestId('page-heading')).toBeVisible();
        await page.getByRole('textbox', { name: /^Search/ }).first().fill(groupName);

        const row = page.locator('table tbody tr').filter({ hasText: groupName }).first();
        await expect(row).toBeVisible();

        // Only badges in an option-group row live in the options cell, so the
        // badge count is the 5 shown options plus the single "+ N more" badge.
        await expect(row.locator('[data-slot="badge"]')).toHaveCount(6);
        await expect(row.getByText('+ 2 more', { exact: true })).toBeVisible();
    });
});
