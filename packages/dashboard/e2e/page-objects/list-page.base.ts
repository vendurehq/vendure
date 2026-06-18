import { type Locator, type Page, expect } from '@playwright/test';

export interface ListPageConfig {
    /** URL path, e.g. '/tax-categories' */
    path: string;
    /** Page heading text, e.g. 'Tax Categories' */
    title: string;
    /** "New" button label, e.g. 'New Tax Category' */
    newButtonLabel: string;
    /** Whether the "new" element is a link (default) or a button. Most pages use a link. */
    newButtonRole?: 'link' | 'button';
}

/**
 * Base page object for all ListPage-based views in the dashboard.
 *
 * Every list screen uses the same `ListPage` component under the hood,
 * so the DOM structure is identical: heading, search input, data table,
 * "New" link button, row checkboxes, and "With selected..." bulk actions.
 */
export class BaseListPage {
    readonly heading: Locator;
    readonly searchInput: Locator;
    readonly dataTable: Locator;
    readonly newButton: Locator;

    constructor(
        protected page: Page,
        protected config: ListPageConfig,
    ) {
        this.heading = page.getByTestId('page-heading');
        this.searchInput = page.getByPlaceholder('Filter...');
        this.dataTable = page.locator('table');
        // Base UI's Button with render={<Link />} adds role="button" to the element
        this.newButton = page.getByRole(config.newButtonRole ?? 'button', { name: config.newButtonLabel });
    }

    async goto() {
        await this.page.goto(this.config.path);
    }

    async expectLoaded() {
        await expect(this.heading).toBeVisible({ timeout: 10_000 });
        await expect(this.dataTable).toBeVisible({ timeout: 10_000 });
    }

    getRows() {
        return this.dataTable.locator('tbody tr');
    }

    /** Click the first button in the data table matching `name` to navigate to its detail page. */
    async clickEntity(name: string) {
        await this.dataTable.getByRole('button', { name }).first().click();
    }

    async clickNewButton() {
        await this.newButton.click();
    }

    async search(term: string) {
        await this.searchInput.fill(term);
        await this.page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);
    }

    async clearSearch() {
        await this.searchInput.clear();
        await this.page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);
    }

    /**
     * Select one or more rows by clicking their checkboxes.
     * Pass 0-based row indices, or 'all' to select via the header checkbox.
     */
    async selectRows(indices: number[] | 'all') {
        if (indices === 'all') {
            // The header checkbox is in the first <th> of the <thead>
            await this.dataTable.locator('thead th').first().getByRole('checkbox').click();
        } else {
            for (const i of indices) {
                await this.getRows().nth(i).getByRole('checkbox').click();
            }
        }
    }

    /** Open the bulk actions dropdown and click "Delete", then confirm. */
    async bulkDelete(indices: number[] | 'all') {
        await this.selectRows(indices);
        // Open "Actions" dropdown
        await this.page.getByRole('button', { name: /Actions/i }).click();
        // Click "Delete" in the dropdown. AlertDialogTrigger renders role="button"
        // instead of role="menuitem", so match by text within the menu.
        await this.page.locator('[role="menu"]').getByText('Delete', { exact: true }).click();
        // Confirm in the AlertDialog
        await this.page.locator('[role="alertdialog"]').getByRole('button', { name: 'Continue' }).click();
    }

    /** Open the row-level action menu (ellipsis) for a specific row index, then click "Delete" and confirm. */
    async deleteRowByIndex(rowIndex: number) {
        const row = this.getRows().nth(rowIndex);
        await row.getByTestId('dt-row-actions-trigger').click();
        await this.page.locator('[role="menu"]').getByText('Delete', { exact: true }).click();
        // Confirm in the AlertDialog
        await this.page.locator('[role="alertdialog"]').getByRole('button', { name: 'Delete' }).click();
    }

    async expectRowCount(count: number) {
        await expect(this.getRows()).toHaveCount(count);
    }

    async expectRowCountGreaterThan(min: number) {
        expect(await this.getRows().count()).toBeGreaterThan(min);
    }

    /** Click the sort button in the column header matching `name`. */
    async clickColumnSort(name: string) {
        const header = this.dataTable.locator('thead th').filter({ hasText: name });
        await header.getByRole('button').first().click();
        await this.page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);
    }

    /** Click the "Go to next page" pagination button. */
    async clickNextPage() {
        await this.page.getByRole('button', { name: 'Go to next page' }).click();
        await this.page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);
    }

    /** Click the "Go to previous page" pagination button. */
    async clickPreviousPage() {
        await this.page.getByRole('button', { name: 'Go to previous page' }).click();
        await this.page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);
    }

    /** Get a locator for the rows-per-page Select trigger in the pagination footer. */
    getPageSizeSelect(): Locator {
        return this.page.locator('[data-slot="select-trigger"]').last();
    }

    /** Open the column settings dropdown (gear icon in the toolbar). */
    async openColumnSettings() {
        await this.page.getByTestId('dt-column-settings-trigger').click();
    }

    /** Open the add filter dropdown menu (filter icon in the toolbar). */
    async openAddFilterMenu() {
        await this.page.getByTestId('dt-add-filter-trigger').click();
    }

    /** Wait for a success toast to appear (handles both toast.success and toast with text). */
    async expectSuccessToast(textMatch?: string | RegExp) {
        if (textMatch) {
            await expect(
                this.page.locator('[data-sonner-toast]').filter({ hasText: textMatch }).first(),
            ).toBeVisible({ timeout: 10_000 });
        } else {
            await expect(
                this.page.locator('[data-sonner-toast]').filter({ hasNotText: /error/i }).first(),
            ).toBeVisible({ timeout: 10_000 });
        }
    }
}
