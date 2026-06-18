import { expect, test, type Page } from '@playwright/test';

import { BaseDetailPage, type FieldInput } from '../page-objects/detail-page.base.js';
import { BaseListPage, type ListPageConfig } from '../page-objects/list-page.base.js';

export interface CrudTestConfig {
    /** Singular entity name for test descriptions, e.g. 'tax category' */
    entityName: string;
    /** Plural entity name, e.g. 'tax categories' */
    entityNamePlural: string;
    /** URL path to the list view, e.g. '/tax-categories' */
    listPath: string;
    /** Text of the page heading, e.g. 'Tax Categories' */
    listTitle: string;
    /** Label on the "New" button, e.g. 'New Tax Category' */
    newButtonLabel: string;
    /** Fields to fill when creating a new entity. */
    createFields: FieldInput[];
    /** Fields to modify when updating the entity. Falls back to createFields with ' Updated' suffix. */
    updateFields?: FieldInput[];
    /**
     * The field value to search for after creation (must match a text value in createFields).
     * If not provided, uses the first text field's createValue.
     */
    searchTerm?: string;
    /** Set to false to skip bulk-delete tests (e.g. if the entity has no bulk action). Defaults to true. */
    hasBulkDelete?: boolean;
    /** Set to false to skip row-level delete tests. Defaults to false (most entities only have bulk delete). */
    hasRowDelete?: boolean;
    /** Set to false for list pages without a search input. Defaults to true. */
    hasSearch?: boolean;
    /** The title shown on the new entity page, e.g. 'New tax category'. */
    newPageTitle: string;
    /** Runs after fillFields in the create flow (e.g. for slug debounce waits). */
    afterFillCreate?: (page: Page, detail: BaseDetailPage) => Promise<void>;
    /** Runs after fillFields in the update flow. Falls back to afterFillCreate if not provided. */
    afterFillUpdate?: (page: Page, detail: BaseDetailPage) => Promise<void>;
}

/**
 * Generates a standard CRUD test suite for a dashboard entity.
 *
 * This factory produces ~8-10 tests covering:
 * 1. List page loads with data
 * 2. "New" button navigates to create form
 * 3. Create a new entity
 * 4. Search for the created entity
 * 5. Navigate to detail by clicking the entity
 * 6. Update the entity
 * 7. Bulk delete (if enabled)
 * 8. Row-level delete (if enabled)
 */
export function createCrudTestSuite(config: CrudTestConfig) {
    const {
        entityName,
        entityNamePlural,
        listPath,
        listTitle,
        newButtonLabel,
        createFields,
        hasBulkDelete = true,
        hasRowDelete = false,
        hasSearch = true,
        newPageTitle,
    } = config;

    const searchTerm = config.searchTerm ?? (createFields.find(f => f.type !== 'switch')?.value as string);

    const updateFields =
        config.updateFields ??
        createFields.map(f => ({
            ...f,
            value: f.type === 'switch' ? !(f.value as boolean) : `${String(f.value)} Updated`,
        }));

    const updatedSearchTerm =
        (updateFields.find(f => f.type !== 'switch')?.value as string) ?? `${searchTerm} Updated`;

    const listConfig: ListPageConfig = {
        path: listPath,
        title: listTitle,
        newButtonLabel,
    };

    const detailConfig = {
        newPath: `${listPath}/new`,
        pathPrefix: `${listPath}/`,
        newTitle: newPageTitle,
    };

    function getListPage(page: Page) {
        return new BaseListPage(page, listConfig);
    }

    function getDetailPage(page: Page) {
        return new BaseDetailPage(page, detailConfig);
    }

    /** Narrow the list via search if supported, otherwise just wait for rows to load. */
    async function narrowList(listPage: BaseListPage, term: string) {
        if (hasSearch) {
            await listPage.search(term);
        }
    }

    // Tests are serial because each step depends on the previous one
    // (create → search → update → delete).
    test.describe(`${entityNamePlural} CRUD`, () => {
        test.describe.configure({ mode: 'serial' });

        // ──────────────────────────────────────────────
        // Test: List page
        // ──────────────────────────────────────────────

        test(`should display the ${entityNamePlural} list page`, async ({ page }) => {
            const listPage = getListPage(page);
            await listPage.goto();
            await listPage.expectLoaded();
        });

        test(`should display the "New" button`, async ({ page }) => {
            const listPage = getListPage(page);
            await listPage.goto();
            await listPage.expectLoaded();
            await expect(listPage.newButton).toBeVisible();
        });

        // ──────────────────────────────────────────────
        // Test: Create
        // ──────────────────────────────────────────────

        test(`should navigate to the create ${entityName} form`, async ({ page }) => {
            const listPage = getListPage(page);
            await listPage.goto();
            await listPage.expectLoaded();
            await listPage.clickNewButton();
            await expect(page).toHaveURL(new RegExp(`${listPath}/new`));
        });

        test(`should create a new ${entityName}`, async ({ page }) => {
            const detail = getDetailPage(page);
            await detail.gotoNew();
            await detail.expectNewPageLoaded();
            await detail.fillFields(createFields);
            await config.afterFillCreate?.(page, detail);
            await detail.clickCreate();
            await detail.expectSuccessToast(/created/i);
            await detail.expectNavigatedToExisting();
        });

        // ──────────────────────────────────────────────
        // Test: Search
        // ──────────────────────────────────────────────

        if (hasSearch) {
            test(`should find the created ${entityName} via search`, async ({ page }) => {
                const listPage = getListPage(page);
                await listPage.goto();
                await listPage.expectLoaded();
                await listPage.search(searchTerm);
                const rows = listPage.getRows();
                await expect(rows.first()).toBeVisible();
                await expect(rows.first()).toContainText(searchTerm);
            });
        }

        // ──────────────────────────────────────────────
        // Test: Navigate to detail
        // ──────────────────────────────────────────────

        test(`should navigate to ${entityName} detail page`, async ({ page }) => {
            const listPage = getListPage(page);
            await listPage.goto();
            await listPage.expectLoaded();
            await narrowList(listPage, searchTerm);
            await listPage.clickEntity(searchTerm);
            await expect(page).toHaveURL(new RegExp(`${listPath}/[^/]+$`));
        });

        // ──────────────────────────────────────────────
        // Test: Update
        // ──────────────────────────────────────────────

        test(`should update the ${entityName}`, async ({ page }) => {
            // Navigate to the entity via list
            const listPage = getListPage(page);
            await listPage.goto();
            await listPage.expectLoaded();
            await narrowList(listPage, searchTerm);
            await listPage.clickEntity(searchTerm);
            await expect(page).toHaveURL(new RegExp(`${listPath}/[^/]+$`));

            // Update the fields
            const detail = getDetailPage(page);
            await detail.fillFields(updateFields);
            await (config.afterFillUpdate ?? config.afterFillCreate)?.(page, detail);
            await detail.clickUpdate();
            await detail.expectSuccessToast(/updated/i);
        });

        // ──────────────────────────────────────────────
        // Test: Verify update
        // ──────────────────────────────────────────────

        test(`should show updated ${entityName} in the list`, async ({ page }) => {
            const listPage = getListPage(page);
            await listPage.goto();
            await listPage.expectLoaded();
            await narrowList(listPage, updatedSearchTerm);
            const rows = listPage.getRows();
            await expect(rows.first()).toBeVisible();
            // Find the row containing the updated name
            await expect(listPage.getRows().filter({ hasText: updatedSearchTerm }).first()).toBeVisible();
        });

        // ──────────────────────────────────────────────
        // Test: Bulk delete
        // ──────────────────────────────────────────────

        if (hasBulkDelete) {
            test(`should bulk-delete ${entityNamePlural}`, async ({ page }) => {
                const listPage = getListPage(page);
                await listPage.goto();
                await listPage.expectLoaded();
                await narrowList(listPage, updatedSearchTerm);
                // Find the row index of our entity to select the right checkbox
                if (hasSearch) {
                    // After search, our entity should be the first/only row
                    await expect(listPage.getRows().first()).toBeVisible();
                    await listPage.bulkDelete([0]);
                } else {
                    // Without search, find and select the specific row
                    const targetRow = listPage.getRows().filter({ hasText: updatedSearchTerm });
                    await expect(targetRow.first()).toBeVisible();
                    await targetRow.first().getByRole('checkbox').click();
                    await page.getByRole('button', { name: /Actions/i }).click();
                    await page.locator('[role="menu"]').getByText('Delete', { exact: true }).click();
                    await page
                        .locator('[role="alertdialog"]')
                        .getByRole('button', { name: 'Continue' })
                        .click();
                }
                await listPage.expectSuccessToast();
            });
        }

        // ──────────────────────────────────────────────
        // Test: Row-level delete
        // ──────────────────────────────────────────────

        if (hasRowDelete) {
            test(`should delete a ${entityName} via row action`, async ({ page }) => {
                // First create a throwaway entity to delete
                const detail = getDetailPage(page);
                await detail.gotoNew();
                await detail.expectNewPageLoaded();
                await detail.fillFields(createFields);
                await config.afterFillCreate?.(page, detail);
                await detail.clickCreate();
                await detail.expectSuccessToast(/created/i);
                await detail.expectNavigatedToExisting();

                // Go back to list, find it, delete via row action
                const listPage = getListPage(page);
                await listPage.goto();
                await listPage.expectLoaded();
                await narrowList(listPage, searchTerm);
                await expect(listPage.getRows().first()).toBeVisible();
                await listPage.deleteRowByIndex(0);
                await listPage.expectSuccessToast();
            });
        }
    }); // end test.describe
}
