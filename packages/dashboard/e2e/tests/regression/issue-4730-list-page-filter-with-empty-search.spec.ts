import { expect, test } from '@playwright/test';

import { BaseListPage } from '../../page-objects/list-page.base.js';

test.describe('Issue 4730 — list-page column filter with empty search', () => {
    // #4730 — list pages that combine `filterOperator: 'OR'` (set via
    // `transformVariables`) with an unguarded `onSearchTermChange` returning
    // `{ field: { contains: searchTerm } }` silently neutralised column filters.
    // With an empty search the `contains: ''` clauses match every row and the
    // OR operator makes the whole filter trivially true regardless of column
    // filters. Customers, countries and promotions were affected; the fix adds
    // a `searchTerm ?` guard on each page plus a framework safety net in
    // `PaginatedListDataTable` that discards the search-term filter when the
    // term is empty.
    test('should apply a column filter on customers list when the search box is empty', async ({ page }) => {
        const lp = new BaseListPage(page, {
            path: '/customers',
            title: 'Customers',
            newButtonLabel: 'New Customer',
        });
        await lp.goto();
        await lp.expectLoaded();

        const initialCount = await lp.getRows().count();
        expect(initialCount).toBeGreaterThan(0);

        // Open the column filter menu and pick the "Email address" column
        await lp.openAddFilterMenu();
        const dropdown = page.locator('[data-slot="dropdown-menu-content"]');
        await expect(dropdown).toBeVisible();
        await dropdown.getByRole('menuitem', { name: /email address/i }).click();

        // Filter dialog opens. The default operator is "contains" — enter a
        // value that no customer in the e2e seed (5 randomly-generated
        // customers) should match.
        const dialog = page.locator('[role="dialog"]');
        await expect(dialog).toBeVisible();
        await dialog.getByPlaceholder('Enter filter value...').fill('OSS-536-NOMATCH-TOKEN');
        await dialog.getByRole('button', { name: 'Apply filter' }).click();

        // Wait for the refetch
        await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);

        // Before the fix this would still show `initialCount` rows because the
        // empty-search `contains: ''` clauses (OR'd in via filterOperator)
        // matched every row, ignoring the column filter entirely. After the
        // fix the only row left is the "No results" empty-state row.
        const filteredCount = await lp.getRows().count();
        expect(filteredCount).toBeLessThan(initialCount);
        await expect(page.getByText('No results', { exact: true })).toBeVisible();
    });
});
