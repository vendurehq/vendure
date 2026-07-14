import { expect, test } from '@playwright/test';

import { BaseListPage } from '../../page-objects/list-page.base.js';
import { createCrudTestSuite } from '../../utils/crud-test-factory.js';

test.describe('Facets', () => {
    test.describe.configure({ mode: 'serial' });

    // The Code field uses a SlugInput that auto-generates from the Name,
    // so we only need to fill Name. Code will auto-populate.
    createCrudTestSuite({
        entityName: 'facet',
        entityNamePlural: 'facets',
        listPath: '/facets',
        listTitle: 'Facets',
        newButtonLabel: 'New Facet',
        newPageTitle: 'New facet',
        createFields: [{ label: 'Name', value: 'E2E Test Facet' }],
        updateFields: [{ label: 'Name', value: 'E2E Test Facet Updated' }],
        hasBulkDelete: true,
    });
});

test.describe('Facet values', () => {
    test.describe.configure({ mode: 'serial' });

    let seededFacetId: string;

    test('should show facet values table on detail page', async ({ page }) => {
        // Navigate to the facet list and click the first seeded facet
        const lp = new BaseListPage(page, {
            path: '/facets',
            title: 'Facets',
            newButtonLabel: 'New Facet',
        });
        await lp.goto();
        await lp.expectLoaded();

        // Click the first facet (seeded data has facets with values)
        await lp.getRows().first().getByRole('button').first().click();
        await expect(page).toHaveURL(/\/facets\/[^/]+/);

        // Extract the facet ID from the URL
        seededFacetId = page.url().match(/\/facets\/([^/]+)/)?.[1] ?? '';
        expect(seededFacetId).toBeTruthy();

        // The "Facet values" section should be visible with a data table
        await expect(page.getByText('Facet values', { exact: true })).toBeVisible();
        const valuesTable = page.locator('table');
        await expect(valuesTable).toBeVisible();
    });

    test('should create a new facet value', async ({ page }) => {
        // Navigate directly to the new facet value form
        await page.goto(`/facets/${seededFacetId}/values/new`);
        await expect(page).toHaveURL(new RegExp(`/facets/${seededFacetId}/values/new`), { timeout: 10_000 });

        // Fill in the facet value name
        const nameField = page.locator('[data-slot="field"]').filter({
            has: page.locator('[data-slot="field-label"]').getByText('Name', { exact: true }),
        });
        await nameField.getByRole('textbox').fill('E2E Test Value');

        // The Code/slug field auto-generates via a debounced API call.
        // Switch to manual mode by clicking the edit button, then fill directly.
        const codeField = page.locator('[data-slot="field"]').filter({
            has: page.locator('[data-slot="field-label"]').getByText('Code', { exact: true }),
        });
        const editSlugButton = codeField.getByRole('button');
        if (await editSlugButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
            await editSlugButton.click();
        }
        await codeField.getByRole('textbox').fill('e2e-test-value');

        // Click Create
        await page.getByRole('button', { name: 'Create', exact: true }).click();

        // Verify success
        await expect(
            page
                .locator('[data-sonner-toast]')
                .filter({ hasText: /created/i })
                .first(),
        ).toBeVisible({ timeout: 10_000 });

        // Should navigate to the created facet value detail page
        await expect(page).toHaveURL(new RegExp(`/facets/${seededFacetId}/values/[^/]+`));
    });

    test('should navigate to facet value detail', async ({ page }) => {
        // Reload the facet detail page and wait for the values API response
        await page.goto(`/facets/${seededFacetId}`);
        await expect(page.getByText('Facet values', { exact: true })).toBeVisible({ timeout: 10_000 });
        // Wait for the facet values query to complete
        await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);
        // Wait for the table row to render
        await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10_000 });

        // Use .first() in case a retry created duplicate entries
        const testValueButton = page.locator('table').getByRole('button', { name: 'E2E Test Value' }).first();
        await testValueButton.scrollIntoViewIfNeeded();
        await testValueButton.click();
        await expect(page).toHaveURL(new RegExp(`/facets/${seededFacetId}/values/[^/]+`));

        // Verify the name field shows the correct value
        const nameField = page.locator('[data-slot="field"]').filter({
            has: page.locator('[data-slot="field-label"]').getByText('Name', { exact: true }),
        });
        await expect(nameField.getByRole('textbox')).toHaveValue('E2E Test Value');
    });

    test('should update a facet value', async ({ page }) => {
        await page.goto(`/facets/${seededFacetId}`);
        await expect(page.getByText('Facet values', { exact: true })).toBeVisible({ timeout: 10_000 });
        await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);

        const testValueButton = page.locator('table').getByRole('button', { name: 'E2E Test Value' }).first();
        await testValueButton.scrollIntoViewIfNeeded();
        await testValueButton.click();
        await expect(page).toHaveURL(new RegExp(`/facets/${seededFacetId}/values/[^/]+`));

        // Wait for form data to fully load before editing
        await page.waitForLoadState('networkidle');
        await expect(page.getByRole('button', { name: 'Update', exact: true })).toBeDisabled({
            timeout: 5_000,
        });

        // Update the name
        const nameField = page.locator('[data-slot="field"]').filter({
            has: page.locator('[data-slot="field-label"]').getByText('Name', { exact: true }),
        });
        await nameField.getByRole('textbox').fill('E2E Test Value Updated');

        // Click Update
        await page.getByRole('button', { name: 'Update', exact: true }).click();
        await expect(
            page
                .locator('[data-sonner-toast]')
                .filter({ hasText: /updated/i })
                .first(),
        ).toBeVisible({ timeout: 10_000 });
    });

    test('should delete the facet value', async ({ page }) => {
        await page.goto(`/facets/${seededFacetId}`);
        await expect(page.getByText('Facet values', { exact: true })).toBeVisible({ timeout: 10_000 });
        await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);

        // Find the row with our test value
        const valuesTable = page.locator('table');
        const testValueRow = valuesTable.locator('tbody tr').filter({ hasText: 'E2E Test Value Updated' });
        await expect(testValueRow).toBeVisible();

        // Select the row checkbox
        await testValueRow.getByRole('checkbox').click();

        // The PaginatedListDataTable uses "Actions" dropdown (not "With selected...")
        await page.getByRole('button', { name: 'Actions' }).click();
        await page.locator('[role="menu"]').getByText('Delete', { exact: true }).click();

        // Confirm deletion
        await page.locator('[role="alertdialog"]').getByRole('button', { name: 'Continue' }).click();

        // Verify the value was deleted
        await expect(
            page.locator('[data-sonner-toast]').filter({ hasNotText: /error/i }).first(),
        ).toBeVisible({ timeout: 10_000 });
    });
});
