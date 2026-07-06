import { type Page, expect, test } from '@playwright/test';

import { BaseDetailPage } from '../../page-objects/detail-page.base.js';
import { createCrudTestSuite } from '../../utils/crud-test-factory.js';
import { VendureAdminClient } from '../../utils/vendure-admin-client.js';

// #4388 — When navigating to a collection detail page and back, the previously
// expanded collection rows should be re-expanded. The fix persists expanded IDs
// in the URL (?expanded=1,2) so the tree is restored on re-mount.
test.describe('Issue #4388: Collection tree expanded state persists in URL', () => {
    test.describe.configure({ mode: 'serial' });

    let parentId: string;
    let childId: string;
    const PARENT_NAME = 'E2E Expand Test Parent';
    const CHILD_NAME = 'E2E Expand Test Child';

    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        const client = new VendureAdminClient(page);
        await client.login();

        const { createCollection: parent } = await client.gql(
            `mutation ($input: CreateCollectionInput!) {
                createCollection(input: $input) { id }
            }`,
            {
                input: {
                    filters: [],
                    translations: [
                        { languageCode: 'en', name: PARENT_NAME, slug: 'e2e-expand-parent', description: '' },
                    ],
                },
            },
        );
        parentId = parent.id as string;

        const { createCollection: child } = await client.gql(
            `mutation ($input: CreateCollectionInput!) {
                createCollection(input: $input) { id }
            }`,
            {
                input: {
                    parentId,
                    filters: [],
                    translations: [
                        { languageCode: 'en', name: CHILD_NAME, slug: 'e2e-expand-child', description: '' },
                    ],
                },
            },
        );
        childId = child.id as string;
        await page.close();
    });

    test.afterAll(async ({ browser }) => {
        const page = await browser.newPage();
        const client = new VendureAdminClient(page);
        await client.login();
        if (childId) {
            await client.gql(`mutation ($id: ID!) { deleteCollection(id: $id) { result } }`, { id: childId });
        }
        if (parentId) {
            await client.gql(`mutation ($id: ID!) { deleteCollection(id: $id) { result } }`, {
                id: parentId,
            });
        }
        await page.close();
    });

    test('should add the expanded collection ID to the URL search params', async ({ page }) => {
        await page.goto('/collections');
        await expect(page.getByRole('heading', { name: 'Collections' })).toBeVisible();

        // The expand button is inside the Name cell (not the drag-handle cell)
        const parentRow = page.locator('tbody tr').filter({ has: page.getByText(PARENT_NAME) });
        const nameCell = parentRow.locator('td').filter({ hasText: PARENT_NAME });
        const expandButton = nameCell.getByLabel(/Expand|Collapse/);
        await expect(expandButton).toBeEnabled({ timeout: 10_000 });
        await expandButton.click();

        // Child collection should appear in the tree
        await expect(page.getByText(CHILD_NAME, { exact: true })).toBeVisible({ timeout: 5_000 });

        // URL must contain ?expanded=<parentId>
        await expect
            .poll(() => new URL(page.url()).searchParams.get('expanded')?.split(',') ?? [])
            .toContain(parentId);
    });

    // This test targets the ROOT CAUSE: queryFn side effects are skipped for TanStack
    // Query cache hits, so accumulatedChildren is never populated on re-mount. The fix
    // syncs cache results to accumulatedChildren via useEffect instead.
    test('should be expandable after navigating directly to detail page without prior expansion', async ({
        page,
    }) => {
        await page.goto('/collections');
        await expect(page.getByRole('heading', { name: 'Collections' })).toBeVisible();

        // Navigate directly to the collection detail — no expansion beforehand,
        // so no ?expanded= param will be in the URL when we return
        const parentRow = page.locator('tbody tr').filter({ has: page.getByText(PARENT_NAME) });
        await parentRow.getByRole('button', { name: PARENT_NAME }).click();
        await page.waitForURL(`/collections/${parentId}`, { timeout: 10_000 });

        // Navigate back — URL has no ?expanded= param
        await page.goBack();
        await page.waitForURL(/\/collections(\?|$)/, { timeout: 10_000 });
        await expect(page).not.toHaveURL(/[?&]expanded=/);

        // The expand button should be enabled and clicking it should show children
        const parentRowAfterBack = page.locator('tbody tr').filter({ has: page.getByText(PARENT_NAME) });
        const nameCell = parentRowAfterBack.locator('td').filter({ hasText: PARENT_NAME });
        const expandButton = nameCell.getByLabel(/Expand|Collapse/);
        await expect(expandButton).toBeEnabled({ timeout: 10_000 });
        await expandButton.click();
        await expect(page.getByText(CHILD_NAME, { exact: true })).toBeVisible({ timeout: 5_000 });
    });

    test('should restore expanded tree after navigating to a collection detail and back', async ({
        page,
    }) => {
        await page.goto('/collections');
        await expect(page.getByRole('heading', { name: 'Collections' })).toBeVisible();

        // Expand the parent collection
        const parentRow = page.locator('tbody tr').filter({ has: page.getByText(PARENT_NAME) });
        const nameCell = parentRow.locator('td').filter({ hasText: PARENT_NAME });
        await nameCell.getByLabel(/Expand|Collapse/).click();
        await expect(page.getByText(CHILD_NAME, { exact: true })).toBeVisible({ timeout: 5_000 });

        // Navigate to the parent collection's detail page
        await parentRow.getByRole('button', { name: PARENT_NAME }).click();
        await page.waitForURL(`/collections/${parentId}`, { timeout: 10_000 });
        await expect(page.getByRole('heading', { name: PARENT_NAME })).toBeVisible({ timeout: 10_000 });

        // Navigate back — the URL still carries ?expanded=<parentId>
        await page.goBack();
        await page.waitForURL(/\/collections(\?|$)/, { timeout: 10_000 });

        // Child should still be visible — expanded state was restored from URL
        await expect(page.getByText(CHILD_NAME, { exact: true })).toBeVisible({ timeout: 5_000 });
    });
});

createCrudTestSuite({
    entityName: 'collection',
    entityNamePlural: 'collections',
    listPath: '/collections',
    listTitle: 'Collections',
    newButtonLabel: 'New Collection',
    newPageTitle: 'New collection',
    createFields: [{ label: 'Name', value: 'E2E Test Collection' }],
    afterFillCreate: async (_page, detail) => {
        await expect(detail.formItem('Slug').getByRole('textbox')).not.toHaveValue('', { timeout: 5_000 });
    },
});

// #4389 — After 3.5.4, collections with filters are not noticed as changed when
// editing name or description, because the combineWithAnd arg (added in 3.5.4) is
// required with a defaultValue, but legacy collections don't have it stored. The
// validity check in ConfigurableOperationInput treated it as permanently invalid,
// keeping the Update button disabled via the filtersArgsValid gate.
test.describe('Issue #4389: Collection form dirty state with filters', () => {
    test.describe.configure({ mode: 'serial' });

    let collectionId: string;

    const detailPage = (page: Page) =>
        new BaseDetailPage(page, {
            newPath: '/collections/new',
            pathPrefix: '/collections/',
            newTitle: 'New collection',
        });

    // Create a collection with a facet-value-filter that deliberately omits the
    // combineWithAnd arg — this simulates legacy collections created before 3.5.4
    // added that argument, which is the root cause of #4389.
    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        const client = new VendureAdminClient(page);
        await client.login();

        // Get a facet value ID to use in the filter
        const { facetValues } = await client.gql(`
            query { facetValues(options: { take: 1 }) { items { id name } } }
        `);
        const facetValueId = facetValues.items[0].id as string;

        // Create collection with filter — note: combineWithAnd is intentionally
        // omitted to reproduce the legacy-data bug
        const { createCollection } = await client.gql(
            `
            mutation ($input: CreateCollectionInput!) {
                createCollection(input: $input) { id }
            }
        `,
            {
                input: {
                    translations: [
                        {
                            languageCode: 'en',
                            name: 'E2E Filter Test',
                            slug: 'e2e-filter-test',
                            description: '',
                        },
                    ],
                    filters: [
                        {
                            code: 'facet-value-filter',
                            arguments: [
                                { name: 'facetValueIds', value: `["${facetValueId}"]` },
                                { name: 'containsAny', value: 'false' },
                            ],
                        },
                    ],
                },
            },
        );
        collectionId = createCollection.id;
        await page.close();
    });

    test.afterAll(async ({ browser }) => {
        if (!collectionId) return;
        const page = await browser.newPage();
        const client = new VendureAdminClient(page);
        await client.login();
        await client.gql(
            `
            mutation ($id: ID!) { deleteCollection(id: $id) { result } }
        `,
            { id: collectionId },
        );
        await page.close();
    });

    async function goToCollection(page: Page) {
        await page.goto(`/collections/${collectionId}`);
        // Wait for the filter card to render — confirms the detail page loaded
        await expect(page.getByText('facet-value-filter')).toBeVisible({ timeout: 10_000 });
    }

    test('should enable Update button when editing the Name field', async ({ page }) => {
        await goToCollection(page);
        const dp = detailPage(page);

        // Update button should be disabled initially
        await expect(dp.updateButton).toBeDisabled();

        // Edit the name
        await dp.fillInput('Name', 'E2E Filter Test Updated');

        // Update button should now be enabled
        await expect(dp.updateButton).toBeEnabled({ timeout: 5_000 });
    });

    test('should enable Update button when editing the Description field', async ({ page }) => {
        await goToCollection(page);
        const dp = detailPage(page);

        await expect(dp.updateButton).toBeDisabled();

        // The description is a TipTap rich text editor (contenteditable),
        // not a regular input. Click the editor area and type.
        const editor = page.getByTestId('rich-text-editor');
        await editor.click();
        await page.keyboard.type('A test description');

        // Click elsewhere to blur and trigger change detection
        await page.getByText('Filters').first().click();

        await expect(dp.updateButton).toBeEnabled({ timeout: 5_000 });
    });

    test('should persist changes after saving', async ({ page }) => {
        await goToCollection(page);
        const dp = detailPage(page);

        await expect(dp.updateButton).toBeDisabled();

        // Edit the name
        await dp.fillInput('Name', 'E2E Filter Test Saved');
        await expect(dp.updateButton).toBeEnabled({ timeout: 5_000 });

        // Save
        await dp.clickUpdate();
        await dp.expectSuccessToast(/updated/i);

        // Reload and verify the change persisted
        await page.reload();
        await expect(page.getByText('facet-value-filter')).toBeVisible({ timeout: 10_000 });
        await expect(dp.formItem('Name').getByRole('textbox')).toHaveValue('E2E Filter Test Saved');
    });
});

// #3548 — Collection facet filter boolean args
test.describe('Issue #3548: Collection facet filter boolean args', () => {
    let collectionId: string;

    const detailPage = (page: Page) =>
        new BaseDetailPage(page, {
            newPath: '/collections/new',
            pathPrefix: '/collections/',
            newTitle: 'New collection',
        });

    test.afterEach(async ({ page }) => {
        if (!collectionId) return;
        const client = new VendureAdminClient(page);
        await client.login();
        await client.gql(
            `
            mutation ($id: ID!) { deleteCollection(id: $id) { result } }
        `,
            { id: collectionId },
        );
        collectionId = '';
    });

    test('should initialize containsAny through the UI when adding a facet-value-filter', async ({
        page,
    }) => {
        const client = new VendureAdminClient(page);
        await client.login();
        const { facetValues } = await client.gql(`
            query { facetValues(options: { take: 1 }) { items { name } } }
        `);
        const facetValueName = facetValues.items[0].name as string;

        const dp = detailPage(page);
        await dp.gotoNew();
        await dp.expectNewPageLoaded();

        await dp.fillInput('Name', 'E2E Boolean Arg Filter');
        await expect(dp.formItem('Slug').getByRole('textbox')).not.toHaveValue('', { timeout: 5_000 });

        await page.getByRole('button', { name: /Add collection filter/i }).click();
        await page.getByRole('menuitem', { name: /Filter by facet values/i }).click();
        await page.getByRole('button', { name: /Add facet values/i }).click();
        await page.getByPlaceholder('Search facet values...').fill(facetValueName);
        await page.getByRole('option', { name: facetValueName, exact: true }).click();

        await expect(
            page.locator('[data-slot="field"]').filter({ hasText: 'Contains any' }).getByRole('switch'),
        ).not.toBeChecked();
        await expect(dp.createButton).toBeEnabled({ timeout: 5_000 });
        await dp.clickCreate();
        await dp.expectNavigatedToExisting();
        collectionId = new URL(page.url()).pathname.split('/').pop() ?? '';

        const { collection } = await client.gql(
            `
            query ($id: ID!) {
                collection(id: $id) {
                    filters {
                        code
                        args { name value }
                    }
                }
            }
        `,
            { id: collectionId },
        );
        const facetFilter = collection.filters.find((filter: any) => filter.code === 'facet-value-filter');
        expect(facetFilter?.args).toEqual(expect.arrayContaining([{ name: 'containsAny', value: 'false' }]));
    });
});
