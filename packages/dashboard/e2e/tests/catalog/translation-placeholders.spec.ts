import { type Page, expect, test } from '@playwright/test';

import { BaseDetailPage } from '../../page-objects/detail-page.base.js';
import { BaseListPage } from '../../page-objects/list-page.base.js';
import { VendureAdminClient } from '../../utils/vendure-admin-client.js';

// Translation fallback placeholder feature:
// When switching to a non-default content language, translatable fields (name,
// slug, description) show the default-language value as an HTML placeholder.
// This suite verifies placeholder presence, absence, and behaviour.
//
// All tests share the same "Laptop" product and must run serially because
// they mutate the channel's available languages and the content language state.

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

    // #4885 / OSS-579 — the update path (the #4962 review regression). On edit, react-hook-form
    // resets the form from the entity, so *nothing* is dirty until the user types. Changing only a
    // non-translation field (here the Enabled switch) must still submit just the persisted `en`
    // translation — the seeded empty `de` row is dropped by its missing `id`, not by dirty state
    // (which is blank here). The dirty-only version kept every row when nothing was dirty and
    // re-created the empty `de` translation on the most common edit path.
    test('updating a non-translation field submits only the existing translation, not a seeded empty one', async ({
        page,
    }) => {
        await goToLaptopProduct(page);
        const productId = new URL(page.url()).pathname.split('/').pop() as string;

        const dp = detailPage(page);
        // Toggle Enabled to make the form dirty *without* touching any translation field.
        const enabledSwitch = dp.formItem('Enabled').getByRole('switch');
        await expect(enabledSwitch).toBeVisible({ timeout: 10_000 });
        // Read via isChecked() (aria-checked), not a data-state attribute — the Base UI switch
        // doesn't expose data-state, so reading it would misdetect the state and make the toggle a
        // no-op, leaving the form pristine and the Update button disabled.
        const wasEnabled = await enabledSwitch.isChecked();
        await dp.toggleSwitch('Enabled', !wasEnabled);
        // The toggle must have dirtied the form, enabling the Update button.
        await expect(page.getByRole('button', { name: 'Update', exact: true })).toBeEnabled({
            timeout: 10_000,
        });

        const updateRequest = page.waitForRequest(
            req => req.method() === 'POST' && (req.postData() ?? '').includes('mutation UpdateProduct('),
            { timeout: 15_000 },
        );
        await dp.clickUpdate();
        const input = (await updateRequest).postDataJSON()?.variables?.input;

        expect(input).toBeTruthy();
        // The persisted English translation (carrying an id) is kept…
        const en = input.translations.find((t: any) => t.languageCode === 'en');
        expect(en?.id).toBeTruthy();
        // …and no empty German row is submitted.
        expect(input.translations.some((t: any) => t.languageCode === 'de')).toBe(false);

        await dp.expectSuccessToast();

        // Restore the original enabled state so the shared Laptop product is unchanged for others.
        const client = new VendureAdminClient(page);
        await client.login();
        await client.gql(`mutation ($input: UpdateProductInput!) { updateProduct(input: $input) { id } }`, {
            input: { id: productId, enabled: wasEnabled },
        });
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
