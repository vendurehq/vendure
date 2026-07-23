import { type Page, expect, test } from '@playwright/test';

import { BaseDetailPage } from '../../page-objects/detail-page.base.js';
import { BaseListPage } from '../../page-objects/list-page.base.js';
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
        // Wait for the filter sentence to render — confirms the detail page loaded
        await expect(page.getByText('Filter by facet values')).toBeVisible({ timeout: 10_000 });
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
        await expect(page.getByText('Filter by facet values')).toBeVisible({ timeout: 10_000 });
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

        // The first empty argument opens automatically when the filter is added.
        await expect(page.getByRole('button', { name: 'Facet values', exact: true })).toHaveAttribute(
            'aria-expanded',
            'true',
        );
        await page.getByRole('button', { name: /Add facet values/i }).click();
        await page.getByPlaceholder('Search facet values...').fill(facetValueName);
        await page.getByRole('option', { name: facetValueName, exact: true }).click();
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');

        // Open the "Contains any" chip popover and verify the switch defaults to off
        await page.getByRole('button', { name: 'Contains any' }).click();
        await expect(
            page.locator('[data-slot="field"]').filter({ hasText: 'Contains any' }).getByRole('switch'),
        ).not.toBeChecked();
        await page.keyboard.press('Escape');
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

test.describe('Collection tree toggles, search subtitles & detail breadcrumb', () => {
    test.describe.configure({ mode: 'serial' });

    const PARENT_NAME = 'E2E Nav Parent';
    const CHILD_NAME = 'E2E Nav Child';
    let parentId = '';
    let childId = '';
    let filterCollectionId = '';

    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        const client = new VendureAdminClient(page);
        await client.login();

        const { createCollection: parent } = await client.gql(
            `mutation ($input: CreateCollectionInput!) { createCollection(input: $input) { id } }`,
            {
                input: {
                    filters: [],
                    translations: [
                        { languageCode: 'en', name: PARENT_NAME, slug: 'e2e-nav-parent', description: '' },
                    ],
                },
            },
        );
        parentId = parent.id as string;

        const { createCollection: child } = await client.gql(
            `mutation ($input: CreateCollectionInput!) { createCollection(input: $input) { id } }`,
            {
                input: {
                    parentId,
                    filters: [],
                    translations: [
                        { languageCode: 'en', name: CHILD_NAME, slug: 'e2e-nav-child', description: '' },
                    ],
                },
            },
        );
        childId = child.id as string;

        // A collection carrying a facet-value-filter, used to exercise the
        // preview → applying → contents flow when a filter is edited and saved.
        const { facetValues } = await client.gql(
            `query { facetValues(options: { take: 1 }) { items { id } } }`,
        );
        const facetValueId = facetValues.items[0].id as string;
        const { createCollection: filtered } = await client.gql(
            `mutation ($input: CreateCollectionInput!) { createCollection(input: $input) { id } }`,
            {
                input: {
                    translations: [
                        {
                            languageCode: 'en',
                            name: 'E2E Filter Edit Test',
                            slug: 'e2e-filter-edit-test',
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
        filterCollectionId = filtered.id as string;
        await page.close();
    });

    test.afterAll(async ({ browser }) => {
        const page = await browser.newPage();
        const client = new VendureAdminClient(page);
        await client.login();
        for (const id of [childId, parentId, filterCollectionId]) {
            if (id) {
                await client.gql(`mutation ($id: ID!) { deleteCollection(id: $id) { result } }`, { id });
            }
        }
        await page.close();
    });

    // Parent rows expose a chevron toggle (aria-label Expand/Collapse); leaf rows
    // render a blank spacer with no toggle. Expanded state is mirrored to ?expanded=.
    test('parent rows toggle children via the chevron; leaf rows have no toggle', async ({ page }) => {
        await page.goto('/collections');
        await expect(page.getByRole('heading', { name: 'Collections' })).toBeVisible();

        const parentRow = page.locator('tbody tr').filter({ has: page.getByText(PARENT_NAME) });
        const parentNameCell = parentRow.locator('td').filter({ hasText: PARENT_NAME });
        const toggle = parentNameCell.getByLabel(/Expand|Collapse/);
        await expect(toggle).toBeEnabled({ timeout: 10_000 });

        // Expand → child appears and the parent id is written to the URL.
        await toggle.click();
        await expect(page.getByText(CHILD_NAME, { exact: true })).toBeVisible({ timeout: 5_000 });
        await expect
            .poll(() => new URL(page.url()).searchParams.get('expanded')?.split(',') ?? [])
            .toContain(parentId);

        // The leaf child row has no expand/collapse toggle.
        const childRow = page
            .locator('tbody tr')
            .filter({ has: page.getByText(CHILD_NAME, { exact: true }) });
        const childNameCell = childRow.locator('td').filter({ hasText: CHILD_NAME });
        await expect(childNameCell.getByLabel(/Expand|Collapse/)).toHaveCount(0);

        // Collapse → child disappears and the URL param clears.
        await toggle.click();
        await expect(page.getByText(CHILD_NAME, { exact: true })).toBeHidden({ timeout: 5_000 });
        await expect.poll(() => new URL(page.url()).searchParams.get('expanded')).toBeFalsy();
    });

    // While searching, matching rows show their ancestor path as a muted subtitle
    // and are not indented; clearing the search restores the top-level tree.
    test('search shows ancestor subtitle and no indentation, then restores on clear', async ({ page }) => {
        await page.goto('/collections');
        await expect(page.getByRole('heading', { name: 'Collections' })).toBeVisible();

        const lp = new BaseListPage(page, {
            path: '/collections',
            title: 'Collections',
            newButtonLabel: 'New Collection',
        });
        await lp.search(CHILD_NAME);

        const childRow = page
            .locator('tbody tr')
            .filter({ has: page.getByText(CHILD_NAME, { exact: true }) });
        await expect(childRow).toBeVisible({ timeout: 10_000 });
        // Ancestor path rendered as a subtitle under the name.
        await expect(childRow.getByText(PARENT_NAME, { exact: true })).toBeVisible();
        // The row is not indented while searching (no left margin on the name wrapper).
        const nameWrapper = childRow
            .locator('td')
            .filter({ hasText: CHILD_NAME })
            .locator('div.flex.gap-2.items-center')
            .first();
        await expect(nameWrapper).toHaveCSS('margin-left', '0px');

        // Clearing the search restores the tree: the child (a non-top-level
        // collection) is no longer shown at the top level.
        await lp.clearSearch();
        await expect(page.getByText(PARENT_NAME, { exact: true })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText(CHILD_NAME, { exact: true })).toHaveCount(0);
    });

    // A nested collection's detail page renders its ancestor(s) as links in the top
    // breadcrumb; clicking an ancestor navigates to that ancestor's detail page.
    test('nested collection detail links ancestors in the breadcrumb', async ({ page }) => {
        await page.goto(`/collections/${childId}`);
        await expect(page.getByRole('heading', { name: CHILD_NAME })).toBeVisible({ timeout: 10_000 });

        // The parent is a navigable breadcrumb link (ancestors use breadcrumb-link;
        // the current collection is a non-navigable breadcrumb-page).
        const parentCrumb = page.locator('[data-slot="breadcrumb-link"]').filter({ hasText: PARENT_NAME });
        await expect(parentCrumb).toBeVisible({ timeout: 10_000 });
        await parentCrumb.click();
        await expect(page).toHaveURL(new RegExp(`/collections/${parentId}$`));
        await expect(page.getByRole('heading', { name: PARENT_NAME })).toBeVisible({ timeout: 10_000 });
    });

    // A top-level collection has no ancestors: its name shows in the breadcrumb, but
    // the only collection-detail breadcrumb link is the current page itself. (Every
    // crumb renders as a link; a nested collection would add one link per ancestor.)
    test('top-level collection detail has no ancestor breadcrumb link', async ({ page }) => {
        await page.goto(`/collections/${parentId}`);
        await expect(page.getByRole('heading', { name: PARENT_NAME })).toBeVisible({ timeout: 10_000 });
        // The collection name is shown in the breadcrumb…
        await expect(
            page.locator('[data-slot="breadcrumb-link"]').filter({ hasText: PARENT_NAME }),
        ).toBeVisible();
        // …and the only collection-detail crumb link is the current page (no ancestor).
        // The "Collections" list link has href "/collections" (no trailing id) and is
        // excluded by the trailing slash.
        await expect(page.locator('[data-slot="breadcrumb-link"][href^="/collections/"]')).toHaveCount(1);
    });

    // The embedded contents table does not opt into saved views but keeps its own
    // search control.
    test('collection contents table omits saved-views tabs but keeps filtering', async ({ page }) => {
        await page.goto(`/collections/${parentId}`);
        await expect(page.getByRole('heading', { name: PARENT_NAME })).toBeVisible({ timeout: 10_000 });

        await expect(page.getByText('Contents', { exact: true })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByTestId('dt-views-tabs')).toHaveCount(0);
        await expect(page.getByRole('textbox', { name: /Search variants/i })).toBeVisible();
    });

    // Editing a saved collection filter shows the preview alert; saving clears the
    // preview and the block eventually resolves to the real contents table.
    // NOTE: the transient "Applying filters…" alert is deliberately NOT asserted — the
    // apply-collection-filters job can settle before the poll flips the UI, so that
    // window is too short to catch reliably (it made the test flaky). We assert the
    // stable start (preview) and end (real contents) states instead.
    test('editing a filter previews, then resolves to real contents on save', async ({ page }) => {
        await page.goto(`/collections/${filterCollectionId}`);
        await expect(page.getByText('Filter by facet values')).toBeVisible({ timeout: 10_000 });
        const dp = new BaseDetailPage(page, {
            newPath: '/collections/new',
            pathPrefix: '/collections/',
            newTitle: 'New collection',
        });

        // Edit the filter: flip the "Contains any" switch inside its chip popover.
        await page.getByRole('button', { name: 'Contains any' }).click();
        await page
            .locator('[data-slot="field"]')
            .filter({ hasText: 'Contains any' })
            .getByRole('switch')
            .click();
        await page.keyboard.press('Escape');

        // The preview alert appears while the filters are dirty. Scope to the alert
        // title so the assertions never collide with the collection name in the
        // breadcrumb/heading.
        const previewAlert = page.locator('[data-slot="alert-title"]').filter({ hasText: 'Preview' });
        const applyingAlert = page
            .locator('[data-slot="alert-title"]')
            .filter({ hasText: /Applying filters/i });
        await expect(previewAlert).toBeVisible({ timeout: 10_000 });

        // Save; the preview/applying alerts eventually clear and the real contents
        // table (its own "Search variants" control) is shown.
        await dp.clickUpdate();
        await dp.expectSuccessToast(/updated/i);
        await expect(previewAlert).toHaveCount(0, { timeout: 35_000 });
        await expect(applyingAlert).toHaveCount(0, { timeout: 35_000 });
        await expect(page.getByRole('textbox', { name: /Search variants/i })).toBeVisible();
    });
});

// #4987 — String list values in configurable-operation inputs (json-string value
// mode) dropped numeric-looking entries: "3249" either failed to render as a badge
// or was overwritten when a second value was added. The fix routes string lists to
// the tag-style StringListInput and stops parseArrayValue from re-serializing an
// already-parsed array. Uses the `string-list-test-filter` registered in
// e2e-shared-config.ts.
test.describe('Issue #4987: String list filter args preserve numeric values', () => {
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
        await client.gql(`mutation ($id: ID!) { deleteCollection(id: $id) { result } }`, {
            id: collectionId,
        });
        collectionId = '';
    });

    test('should keep numeric-looking values through add, save and reload', async ({ page }) => {
        const client = new VendureAdminClient(page);
        await client.login();

        const dp = detailPage(page);
        await dp.gotoNew();
        await dp.expectNewPageLoaded();

        await dp.fillInput('Name', 'E2E String List Filter');
        await expect(dp.formItem('Slug').getByRole('textbox')).not.toHaveValue('', { timeout: 5_000 });

        await page.getByRole('button', { name: /Add collection filter/i }).click();
        await page.getByRole('menuitem', { name: /Filter by external IDs/i }).click();

        const listInput = page.getByPlaceholder('Type and press Enter or comma to add...');
        await expect(listInput).toBeVisible({ timeout: 5_000 });

        // A single numeric value renders as a badge rather than being dropped.
        await listInput.fill('3249');
        await listInput.press('Enter');
        await expect(page.getByLabel('Remove 3249')).toBeVisible({ timeout: 5_000 });

        // Adding a second value keeps the first instead of overwriting it.
        await listInput.fill('5');
        await listInput.press('Enter');
        await expect(page.getByLabel('Remove 3249')).toBeVisible();
        await expect(page.getByLabel('Remove 5')).toBeVisible();

        await expect(dp.createButton).toBeEnabled({ timeout: 5_000 });
        await dp.clickCreate();
        await dp.expectNavigatedToExisting();
        collectionId = new URL(page.url()).pathname.split('/').pop() ?? '';

        // Both values survive a reload.
        await page.reload();
        await page.getByRole('button', { name: 'externalIds', exact: true }).click();
        await expect(page.getByLabel('Remove 3249')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByLabel('Remove 5')).toBeVisible();

        // ...and are stored verbatim, in order.
        const { collection } = await client.gql(
            `query ($id: ID!) {
                collection(id: $id) { filters { code args { name value } } }
            }`,
            { id: collectionId },
        );
        const filter = collection.filters.find((f: any) => f.code === 'string-list-test-filter');
        expect(filter?.args).toEqual(
            expect.arrayContaining([{ name: 'externalIds', value: '["3249","5"]' }]),
        );
    });
});
