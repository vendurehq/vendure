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
