import { type Page, expect, test } from '@playwright/test';

import { BaseListPage } from '../../page-objects/list-page.base.js';
import { createCrudTestSuite } from '../../utils/crud-test-factory.js';
import { VendureAdminClient } from '../../utils/vendure-admin-client.js';

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

test.describe('Facet list & detail improvements', () => {
    test.describe.configure({ mode: 'serial' });

    // A facet with only 2 values — below the 3-value threshold that gates the
    // "+N more" values-sheet trigger on the list.
    const SMALL_FACET_NAME = 'E2E Small Facet';
    let smallFacetId = '';
    // The seeded "category" facet has 6 values (> 3), so it should show the trigger.
    let bigFacetId = '';
    let bigFacetName = '';

    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        const client = new VendureAdminClient(page);
        await client.login();

        const { createFacet } = await client.gql(
            `mutation ($input: CreateFacetInput!) { createFacet(input: $input) { id } }`,
            {
                input: {
                    code: 'e2e-small-facet',
                    isPrivate: false,
                    translations: [{ languageCode: 'en', name: SMALL_FACET_NAME }],
                    values: [
                        {
                            code: 'e2e-small-a',
                            translations: [{ languageCode: 'en', name: 'E2E Small Value A' }],
                        },
                        {
                            code: 'e2e-small-b',
                            translations: [{ languageCode: 'en', name: 'E2E Small Value B' }],
                        },
                    ],
                },
            },
        );
        smallFacetId = createFacet.id as string;

        const { facets } = await client.gql(
            `query { facets(options: { take: 100 }) { items { id name valueList { totalItems } } } }`,
        );
        const big = facets.items.find((f: any) => f.valueList.totalItems > 3);
        bigFacetId = (big?.id as string) ?? '';
        bigFacetName = (big?.name as string) ?? '';
        await page.close();
    });

    test.afterAll(async ({ browser }) => {
        if (!smallFacetId) return;
        const page = await browser.newPage();
        const client = new VendureAdminClient(page);
        await client.login();
        await client.gql(`mutation ($id: ID!) { deleteFacet(id: $id, force: true) { result } }`, {
            id: smallFacetId,
        });
        await page.close();
    });

    // The list's Values column is hidden by default; enable it so the value chips
    // and "+N more" trigger are on screen.
    async function ensureValuesColumnVisible(page: Page) {
        const header = page.locator('thead th').filter({ hasText: 'Values' }).first();
        if (await header.isVisible().catch(() => false)) return;
        await page.getByTestId('dt-column-settings-trigger').click();
        await page.getByRole('menuitemcheckbox', { name: /value list/i }).click();
        await page.keyboard.press('Escape');
        await expect(header).toBeVisible({ timeout: 5_000 });
    }

    function listPage(page: Page) {
        return new BaseListPage(page, {
            path: '/facets',
            title: 'Facets',
            newButtonLabel: 'New Facet',
        });
    }

    // A facet with more than 3 values renders a "+N more" trigger that opens the
    // values sheet.
    test('should show a "+N more" values sheet trigger for a facet with more than 3 values', async ({
        page,
    }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await ensureValuesColumnVisible(page);

        const moreTrigger = page.getByRole('button', { name: /\+\s*\d+\s*more/ }).first();
        await expect(moreTrigger).toBeVisible({ timeout: 10_000 });
        await moreTrigger.click();

        // The sheet opens showing the parent facet's values in a table.
        const sheet = page.getByRole('dialog');
        await expect(sheet).toBeVisible({ timeout: 10_000 });
        await expect(sheet.getByRole('heading', { name: /Facet values for/i })).toBeVisible();
        await expect(sheet.locator('table')).toBeVisible();
    });

    // A facet with 3 or fewer values shows its chips but no values-sheet trigger.
    test('should not show a values sheet trigger for a facet with 3 or fewer values', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await ensureValuesColumnVisible(page);

        const smallRow = page.locator('tbody tr').filter({ hasText: SMALL_FACET_NAME });
        await expect(smallRow).toBeVisible({ timeout: 10_000 });
        // Both values render as chips…
        await expect(smallRow.getByText('E2E Small Value A')).toBeVisible();
        await expect(smallRow.getByText('E2E Small Value B')).toBeVisible();
        // …and there is no "+N more" sheet trigger in the row.
        await expect(smallRow.getByRole('button', { name: /more/i })).toHaveCount(0);
    });

    // The embedded facet-values table on the detail page does not opt into saved
    // views, but keeps its filter controls working.
    test('facet detail values table omits saved-views tabs and still filters', async ({ page }) => {
        await page.goto(`/facets/${bigFacetId}`);
        await expect(page.getByText('Facet values', { exact: true })).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10_000 });

        // Embedded table does not render the opt-in saved-views tabs…
        await expect(page.getByTestId('dt-views-tabs')).toHaveCount(0);
        // …but keeps its search control: filtering narrows the rows.
        const search = page.getByRole('textbox', { name: /Search facet values/i });
        await expect(search).toBeVisible();
        await search.fill('electronics');
        await expect(page.locator('table').getByRole('button', { name: 'electronics' })).toBeVisible({
            timeout: 10_000,
        });
        await expect(page.locator('table tbody tr')).toHaveCount(1);
    });

    // The facet value detail breadcrumb includes the parent facet as a link that
    // navigates back to the parent facet detail page (there is no sidebar facet card).
    test('facet value detail breadcrumb links back to the parent facet', async ({ page }) => {
        await page.goto(`/facets/${bigFacetId}`);
        await expect(page.getByText('Facet values', { exact: true })).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10_000 });

        // Open the first facet value's detail page.
        await page.locator('table tbody tr').first().getByRole('button').first().click();
        await expect(page).toHaveURL(new RegExp(`/facets/${bigFacetId}/values/[^/]+`));

        // The breadcrumb links to the parent facet…
        const breadcrumbLink = page
            .locator('[data-slot="breadcrumb-link"]')
            .filter({ hasText: bigFacetName });
        await expect(breadcrumbLink).toBeVisible({ timeout: 10_000 });
        await breadcrumbLink.click();
        // …and navigates back to the parent facet detail page.
        await expect(page).toHaveURL(new RegExp(`/facets/${bigFacetId}$`));
        await expect(page.getByTestId('page-heading')).toHaveText(bigFacetName);
    });
});
