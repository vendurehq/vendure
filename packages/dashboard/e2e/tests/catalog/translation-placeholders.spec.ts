import { type Page, expect, test } from '@playwright/test';

import { BaseDetailPage } from '../../page-objects/detail-page.base.js';
import { BaseListPage } from '../../page-objects/list-page.base.js';
import { VendureAdminClient } from '../../utils/vendure-admin-client.js';

// Translation fallback placeholder feature:
// When switching to a non-default content language, translatable fields (name,
// slug, description) show the default-language value as an HTML placeholder.
// This suite verifies placeholder presence, absence, and behaviour.
//
// The placeholder tests share the same "Laptop" product, and the slug tests (#5476) add German
// to collections they create. All tests must run serially because they mutate the channel's
// available languages and the content language state.

const listPage = (page: Page) =>
    new BaseListPage(page, {
        path: '/products',
        title: 'Products',
        newButtonLabel: 'New Product',
    });

const detailPage = (page: Page) =>
    new BaseDetailPage(page, {
        newPath: '/products/new',
        pathPrefix: '/products/',
        newTitle: 'New product',
    });

const collectionDetailPage = (page: Page) =>
    new BaseDetailPage(page, {
        newPath: '/collections/new',
        pathPrefix: '/collections/',
        newTitle: 'New collection',
    });

/** Create a collection with only an English translation, for tests that add a second language. */
async function createEnglishOnlyCollection(page: Page, name: string, slug: string): Promise<string> {
    const client = new VendureAdminClient(page);
    await client.login();
    const { createCollection } = await client.gql(
        `mutation ($input: CreateCollectionInput!) { createCollection(input: $input) { id } }`,
        { input: { filters: [], translations: [{ languageCode: 'en', name, slug, description: '' }] } },
    );
    return createCollection.id;
}

async function deleteCollection(page: Page, id: string) {
    const client = new VendureAdminClient(page);
    await client.login();
    await client.gql(`mutation ($id: ID!) { deleteCollection(id: $id) { result } }`, { id });
}

/** Navigate to the Laptop product detail page and wait for the form to finish loading. */
async function goToLaptopProduct(page: Page) {
    const lp = listPage(page);
    await lp.goto();
    await lp.expectLoaded();
    await lp.search('Laptop');
    await lp.clickEntity('Laptop');
    await expect(page).toHaveURL(/\/products\/[^/]+$/);
    const dp = detailPage(page);
    await expect(dp.formItem('Product name').getByRole('textbox')).toHaveValue('Laptop', { timeout: 10_000 });
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: 'Update', exact: true })).toBeDisabled({ timeout: 10_000 });
}

/**
 * Switch the dashboard content language by updating localStorage directly.
 *
 * This is more reliable than navigating the channel-switcher dropdown in CI,
 * where nested submenus and hover interactions can be flaky. After updating
 * the setting, a full page reload is triggered so the dashboard picks up
 * the new language and re-fetches all data.
 */
async function switchContentLanguage(page: Page, languageCode: string) {
    // Navigate to the app first if on about:blank (localStorage requires a real origin)
    if (page.url() === 'about:blank') {
        await page.goto('/');
        await page.waitForLoadState('networkidle');
    }
    await page.evaluate(langCode => {
        const key = 'vendure-user-settings';
        const settings = JSON.parse(localStorage.getItem(key) || '{}');
        settings.contentLanguage = langCode;
        localStorage.setItem(key, JSON.stringify(settings));
    }, languageCode);
    await page.reload();
    await page.waitForLoadState('networkidle');
}

test.describe('Translation fallback placeholders', () => {
    test.describe.configure({ mode: 'serial' });

    // ── Setup: add German to the channel's available languages ──────────

    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        const client = new VendureAdminClient(page);
        await client.login();

        // First, add German to the global available languages
        const globalData = await client.gql(`
            query {
                globalSettings {
                    id
                    availableLanguages
                }
            }
        `);
        const globalLanguages: string[] = globalData.globalSettings.availableLanguages;
        if (!globalLanguages.includes('de')) {
            await client.gql(
                `mutation UpdateGlobalSettings($input: UpdateGlobalSettingsInput!) {
                    updateGlobalSettings(input: $input) {
                        ... on GlobalSettings { id availableLanguages }
                        ... on ErrorResult { errorCode message }
                    }
                }`,
                {
                    input: {
                        availableLanguages: [...globalLanguages, 'de'],
                    },
                },
            );
        }

        // Then add German to the channel's available languages
        const channelData = await client.gql(`
            query {
                activeChannel {
                    id
                    availableLanguageCodes
                }
            }
        `);
        const channelId = channelData.activeChannel.id;
        const currentLanguages: string[] = channelData.activeChannel.availableLanguageCodes;
        if (!currentLanguages.includes('de')) {
            await client.gql(
                `mutation UpdateChannel($input: UpdateChannelInput!) {
                    updateChannel(input: $input) {
                        ... on Channel { id availableLanguageCodes }
                        ... on LanguageNotAvailableError { errorCode message }
                    }
                }`,
                {
                    input: {
                        id: channelId,
                        availableLanguageCodes: [...currentLanguages, 'de'],
                    },
                },
            );
        }

        await page.close();
    });

    // ── Test 1: Name placeholder when switching to non-default language ─

    test('should show fallback placeholder for name field when switching to non-default language', async ({
        page,
    }) => {
        // Navigate to the product while on English (default) so goToLaptopProduct
        // assertions pass, then switch to German which reloads the same page.
        await goToLaptopProduct(page);
        await switchContentLanguage(page, 'de');

        // The name input should now show the English name as a placeholder
        const nameInput = detailPage(page).formItem('Product name').getByRole('textbox');
        await expect(nameInput).toHaveAttribute('placeholder', 'Fallback: Laptop', { timeout: 10_000 });
    });

    // ── Test 2: Slug placeholder ────────────────────────────────────────

    test('should show fallback placeholder for slug field', async ({ page }) => {
        await goToLaptopProduct(page);
        await switchContentLanguage(page, 'de');

        // The slug input is inside a SlugInput component. When no value is
        // set for German and the slug is in readonly mode, the external
        // placeholder from TranslatableFormFieldWrapper is used.
        // The slug field renders an <input> inside the SlugInput wrapper.
        const slugFormItem = detailPage(page).formItem('Slug');
        const slugInput = slugFormItem.locator('input').first();
        await expect(slugInput).toHaveAttribute('placeholder', /Fallback: .*laptop/, { timeout: 10_000 });
    });

    // ── Test 3: No placeholder on default language ──────────────────────

    test('should NOT show placeholder when on default language', async ({ page }) => {
        // Switch back to English
        await switchContentLanguage(page, 'en');
        await goToLaptopProduct(page);

        // We're on English (default language) - no placeholder should be present
        // or the placeholder should NOT be the fallback value "Laptop"
        const nameInput = detailPage(page).formItem('Product name').getByRole('textbox');

        // On the default language, the input has the actual value, not a fallback placeholder.
        // The placeholder attribute should either be absent or empty (not the English name).
        await expect(nameInput).toHaveValue('Laptop');
        const placeholder = await nameInput.getAttribute('placeholder');
        expect(placeholder ?? '').not.toBe('Fallback: Laptop');
    });

    // ── Test 4: Placeholder hidden once user types a translation ────────

    test('should remove placeholder when user types a translation', async ({ page }) => {
        await goToLaptopProduct(page);
        await switchContentLanguage(page, 'de');

        const nameInput = detailPage(page).formItem('Product name').getByRole('textbox');

        // Verify the placeholder is present first
        await expect(nameInput).toHaveAttribute('placeholder', 'Fallback: Laptop', { timeout: 10_000 });

        // Type a German translation
        await nameInput.fill('Laptop (Deutsch)');

        // The HTML placeholder is still in the DOM, but with a value present
        // the browser hides it visually. Verify the input has the typed value.
        await expect(nameInput).toHaveValue('Laptop (Deutsch)');
    });

    // ── Test 5: Placeholder for rich text description ───────────────────

    test('should show placeholder for rich text description', async ({ page }) => {
        await goToLaptopProduct(page);
        await switchContentLanguage(page, 'de');

        // TipTap's Placeholder extension adds a `data-placeholder` attribute to
        // the first empty child element with class `is-editor-empty`. The CSS
        // displays it via `content: attr(data-placeholder)`.
        const editorContainer = page.getByTestId('rich-text-editor');
        await expect(editorContainer).toBeVisible({ timeout: 10_000 });

        // The placeholder is set on the empty paragraph element inside the editor.
        // When the description field is empty for the German translation, TipTap
        // adds the `.is-editor-empty` class and the `data-placeholder` attribute.
        const emptyEditorNode = editorContainer.locator('.is-editor-empty[data-placeholder]');
        await expect(emptyEditorNode).toBeVisible({ timeout: 10_000 });

        // Verify the data-placeholder contains the English description text
        // (stripped of HTML tags by RichTextInput). The Laptop description
        // starts with "Now equipped with seventh-generation..."
        const placeholderValue = await emptyEditorNode.getAttribute('data-placeholder');
        expect(placeholderValue).toBeTruthy();
        expect(placeholderValue).toContain('Now equipped with seventh-generation');
    });

    // #4885 / OSS-579 — with German available, the form seeds a translation row for both en and de.
    // Filling only the default language and submitting must send a single `en` translation, not an
    // empty `de` row (which would break language fallback). This exercises the real react-hook-form
    // path that the unit tests can't: `stripUntouchedTranslations` reads `dirtyFields`, which
    // react-hook-form only populates when it is read during render — if the wiring regressed to
    // reading it only in the submit handler, the fix would silently no-op and the empty `de` row
    // would come back here.
    test('creating a product with only the default language filled submits a single translation', async ({
        page,
    }) => {
        const dp = detailPage(page);
        await dp.gotoNew();
        await dp.expectNewPageLoaded();

        const name = `OSS579 Only-EN ${Date.now()}`;
        // Slug is auto-generated from the name (its input is disabled), so filling the name is enough.
        await dp.fillInput('Product name', name);

        const createRequest = page.waitForRequest(
            req => req.method() === 'POST' && (req.postData() ?? '').includes('mutation CreateProduct('),
            { timeout: 15_000 },
        );
        await dp.clickCreate();
        const input = (await createRequest).postDataJSON()?.variables?.input;

        expect(input).toBeTruthy();
        expect(input.translations).toHaveLength(1);
        expect(input.translations[0].languageCode).toBe('en');
        expect(input.translations[0].name).toBe(name);
        expect(input.translations.some((t: any) => t.languageCode === 'de')).toBe(false);

        await dp.expectSuccessToast();

        // Clean up the product we just created so the suite stays re-runnable.
        const createdId = new URL(page.url()).pathname.split('/').pop();
        if (createdId && createdId !== 'new') {
            const client = new VendureAdminClient(page);
            await client.login();
            await client.gql(`mutation ($id: ID!) { deleteProduct(id: $id) { result } }`, { id: createdId });
        }
    });

    // #4885 / OSS-579 — the update path (the #4962 review regression): changing only a
    // non-translation field (here the Enabled switch) must never re-create the seeded empty `de`
    // translation row. Since OSS-567 (#4916), the changed-fields-only update goes one better and
    // omits the untouched `translations` array from the payload entirely — so no translation rows
    // (empty or otherwise) are submitted on this edit path, and the server keeps the persisted ones
    // untouched. This asserts that omission, which subsumes the original stripUntouchedTranslations
    // guarantee for the non-translation-edit case.
    test('updating a non-translation field omits the untouched translations array', async ({ page }) => {
        await goToLaptopProduct(page);
        const productId = new URL(page.url()).pathname.split('/').pop() as string;

        const dp = detailPage(page);
        // Toggle Enabled to make the form dirty *without* touching any translation field.
        const enabledSwitch = page.getByTestId('product-enabled-switch').getByRole('switch');
        await expect(enabledSwitch).toBeVisible({ timeout: 10_000 });
        // Read via isChecked() (aria-checked), not a data-state attribute — the Base UI switch
        // doesn't expose data-state, so reading it would misdetect the state and make the toggle a
        // no-op, leaving the form pristine and the Update button disabled.
        const wasEnabled = await enabledSwitch.isChecked();
        await enabledSwitch.setChecked(!wasEnabled);
        // The toggle must have dirtied the form, enabling the Update button.
        await expect(page.getByRole('button', { name: 'Update', exact: true })).toBeEnabled({
            timeout: 10_000,
        });

        const updateRequest = page.waitForRequest(
            req => req.method() === 'POST' && (req.postData() ?? '').includes('mutation UpdateProduct('),
            { timeout: 15_000 },
        );
        await page.getByRole('button', { name: 'Update', exact: true }).click();
        const input = (await updateRequest).postDataJSON()?.variables?.input;

        expect(input).toBeTruthy();
        // `translations` was never touched, so the changed-fields-only update omits it — no empty
        // `de` row (nor any other translation row) can be submitted on this edit path.
        expect(input.translations).toBeUndefined();

        await dp.expectSuccessToast();

        // Restore the original enabled state so the shared Laptop product is unchanged for others.
        const client = new VendureAdminClient(page);
        await client.login();
        await client.gql(`mutation ($input: UpdateProductInput!) { updateProduct(input: $input) { id } }`, {
            input: { id: productId, enabled: wasEnabled },
        });
    });

    // #5408 — a stale tab must not revert a translation saved elsewhere. The page loads a product
    // with `en` and `de` rows, then the `de` name changes behind the page's back (as if saved from
    // another tab). Editing only the `en` name and saving must leave the newer `de` name alone.
    test('editing one language does not revert another language saved elsewhere', async ({ page }) => {
        const client = new VendureAdminClient(page);
        await client.login();
        const suffix = Date.now();
        const { createProduct } = await client.gql(
            `mutation ($input: CreateProductInput!) { createProduct(input: $input) { id } }`,
            {
                input: {
                    translations: [
                        { languageCode: 'en', name: `EN ${suffix}`, slug: `en-${suffix}`, description: '' },
                        {
                            languageCode: 'de',
                            name: `Stale DE ${suffix}`,
                            slug: `de-${suffix}`,
                            description: '',
                        },
                    ],
                },
            },
        );
        const productId = createProduct.id;

        try {
            const dp = detailPage(page);
            await dp.gotoExisting(productId);
            await expect(dp.formItem('Product name').getByRole('textbox')).toHaveValue(`EN ${suffix}`, {
                timeout: 10_000,
            });
            await page.waitForLoadState('networkidle');

            // Another tab saves a new German name.
            await client.gql(
                `mutation ($input: UpdateProductInput!) { updateProduct(input: $input) { id } }`,
                {
                    input: {
                        id: productId,
                        translations: [{ languageCode: 'de', name: `Fresh DE ${suffix}` }],
                    },
                },
            );

            // The stale page edits only the English name and saves.
            await dp.fillInput('Product name', `Edited EN ${suffix}`);
            await dp.clickUpdate();
            await dp.expectSuccessToast();

            const { product } = await client.gql(
                `query ($id: ID!) { product(id: $id) { translations { languageCode name } } }`,
                { id: productId },
            );
            const nameFor = (code: string) =>
                product.translations.find((t: any) => t.languageCode === code)?.name;
            expect(nameFor('en')).toBe(`Edited EN ${suffix}`);
            expect(nameFor('de')).toBe(`Fresh DE ${suffix}`);
        } finally {
            await client.gql(`mutation ($id: ID!) { deleteProduct(id: $id) { result } }`, { id: productId });
        }
    });

    // A create page with `setValuesForCreate`, reached from an edit page while the page stays mounted,
    // must compare the form against the create defaults, not the edited product. Otherwise the
    // product's `de` row makes the empty `de` row count as changed, and the create fails with
    // "The "name" field cannot be blank".
    test('a create page with starting values opened from an edit page creates the product', async ({
        page,
    }) => {
        const client = new VendureAdminClient(page);
        await client.login();
        const suffix = Date.now();
        const { createProduct } = await client.gql(
            `mutation ($input: CreateProductInput!) { createProduct(input: $input) { id } }`,
            {
                input: {
                    translations: [
                        {
                            languageCode: 'en',
                            name: `Edit to new ${suffix}`,
                            slug: `edit-to-new-${suffix}`,
                            description: '',
                        },
                        {
                            languageCode: 'de',
                            name: `Edit to new DE ${suffix}`,
                            slug: `edit-to-new-de-${suffix}`,
                            description: '',
                        },
                    ],
                },
            },
        );

        await page.goto(`/starting-values-test/first/${String(createProduct.id)}`);
        await expect(page.getByRole('button', { name: 'Update', exact: true })).toBeVisible({
            timeout: 10_000,
        });
        await page.getByRole('link', { name: 'Open create page with preset "other"' }).click();
        await expect(page).toHaveURL(/\/starting-values-test\/other\/new$/);
        await page.getByRole('button', { name: 'Create', exact: true }).click();
        await expect(page).toHaveURL(/\/starting-values-test\/other\/(?!new$)[^/]+$/);

        // Clean up both products so the suite stays re-runnable.
        const createdId = new URL(page.url()).pathname.split('/').pop();
        for (const id of [createProduct.id, createdId]) {
            await client.gql(`mutation ($id: ID!) { deleteProduct(id: $id) { result } }`, { id });
        }
    });

    // #5476 — a language added to an existing entity must get a generated slug, not an empty one
    test('generates the slug of a new language on an existing collection', async ({ page }) => {
        const stamp = Date.now();
        const name = `Issue 5476 ${stamp}`;
        const deName = `Kollektion 5476 ${stamp}`;
        const deSlug = `kollektion-5476-${stamp}`;
        const collectionId = await createEnglishOnlyCollection(page, name, `issue-5476-${stamp}`);
        try {
            const dp = collectionDetailPage(page);
            await dp.gotoExisting(collectionId);
            await expect(dp.formItem('Name').getByRole('textbox')).toHaveValue(name, { timeout: 10_000 });

            await switchContentLanguage(page, 'de');
            await dp.fillInput('Name', deName);
            await expect(dp.formItem('Slug').getByRole('textbox')).toHaveValue(deSlug, { timeout: 10_000 });

            await dp.clickUpdate();
            // The form is saved once Update is disabled again (the success toast auto-dismisses too fast).
            await expect(dp.updateButton).toBeDisabled({ timeout: 10_000 });

            const client = new VendureAdminClient(page);
            await client.login();
            const { collection } = await client.gql(
                `query ($id: ID!) { collection(id: $id) { translations { languageCode slug } } }`,
                { id: collectionId },
            );
            const de = collection.translations.find((t: { languageCode: string }) => t.languageCode === 'de');
            expect(de?.slug).toBe(deSlug);
        } finally {
            await switchContentLanguage(page, 'en');
            await deleteCollection(page, collectionId);
        }
    });

    // #5476 — the slug of an existing translation must not be regenerated when its name changes
    test('leaves an existing slug alone when the name changes', async ({ page }) => {
        const stamp = Date.now();
        const name = `Issue 5476 rename ${stamp}`;
        const slug = `issue-5476-rename-${stamp}`;
        const collectionId = await createEnglishOnlyCollection(page, name, slug);
        try {
            const dp = collectionDetailPage(page);
            await dp.gotoExisting(collectionId);
            await expect(dp.formItem('Name').getByRole('textbox')).toHaveValue(name, { timeout: 10_000 });

            await dp.fillInput('Name', `${name} renamed`);
            // Outlive the 500ms generation debounce before asserting nothing changed.
            await page.waitForTimeout(1_500);
            await expect(dp.formItem('Slug').getByRole('textbox')).toHaveValue(slug);
        } finally {
            await deleteCollection(page, collectionId);
        }
    });

    // ── Cleanup: switch back to English ─────────────────────────────────

    test.afterAll(async ({ browser }) => {
        const page = await browser.newPage();
        const client = new VendureAdminClient(page);
        await client.login();

        // Restore the channel to English only
        const channelData = await client.gql(`
            query {
                activeChannel {
                    id
                }
            }
        `);
        await client.gql(
            `mutation UpdateChannel($input: UpdateChannelInput!) {
                updateChannel(input: $input) {
                    ... on Channel { id availableLanguageCodes }
                    ... on LanguageNotAvailableError { errorCode message }
                }
            }`,
            {
                input: {
                    id: channelData.activeChannel.id,
                    availableLanguageCodes: ['en'],
                },
            },
        );

        // Restore global settings to English only
        await client.gql(
            `mutation UpdateGlobalSettings($input: UpdateGlobalSettingsInput!) {
                updateGlobalSettings(input: $input) {
                    ... on GlobalSettings { id availableLanguages }
                    ... on ErrorResult { errorCode message }
                }
            }`,
            {
                input: {
                    availableLanguages: ['en'],
                },
            },
        );

        await page.close();
    });
});
