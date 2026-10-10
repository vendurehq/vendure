import { type Page, expect, test } from '@playwright/test';

import { BaseDetailPage } from '../../page-objects/detail-page.base.js';
import { VendureAdminClient } from '../../utils/vendure-admin-client.js';

// Regression: https://github.com/vendurehq/vendure/issues/5476
//
// SlugInput only auto-generated while creating, so a translation added to an existing
// entity was saved with an empty slug.

const detailPage = (page: Page) =>
    new BaseDetailPage(page, {
        newPath: '/collections/new',
        pathPrefix: '/collections/',
        newTitle: 'New collection',
    });

async function switchContentLanguage(page: Page, languageCode: string) {
    await page.evaluate(langCode => {
        const key = 'vendure-user-settings';
        const settings = JSON.parse(localStorage.getItem(key) || '{}');
        settings.contentLanguage = langCode;
        localStorage.setItem(key, JSON.stringify(settings));
    }, languageCode);
    await page.reload();
    await page.waitForLoadState('networkidle');
}

test.describe('Issue 5476 — slug generated for a translation added on update', () => {
    test.describe.configure({ mode: 'serial' });

    const stamp = Date.now();
    const name = `Issue 5476 ${stamp}`;
    const slug = `issue-5476-${stamp}`;
    const plName = `Kolekcja 5476 ${stamp}`;
    const plSlug = `kolekcja-5476-${stamp}`;
    let collectionId = '';
    // Only undo what this suite enabled, so a pre-existing `pl` stays available.
    let addedPlGlobally = false;
    let addedPlToChannel = false;

    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        const client = new VendureAdminClient(page);
        await client.login();

        const { globalSettings } = await client.gql(`query { globalSettings { availableLanguages } }`);
        if (!globalSettings.availableLanguages.includes('pl')) {
            await client.gql(
                `mutation ($input: UpdateGlobalSettingsInput!) {
                    updateGlobalSettings(input: $input) { ... on GlobalSettings { id } }
                }`,
                { input: { availableLanguages: [...globalSettings.availableLanguages, 'pl'] } },
            );
            addedPlGlobally = true;
        }
        const { activeChannel } = await client.gql(`query { activeChannel { id availableLanguageCodes } }`);
        if (!activeChannel.availableLanguageCodes.includes('pl')) {
            await client.gql(
                `mutation ($input: UpdateChannelInput!) {
                    updateChannel(input: $input) { ... on Channel { id } }
                }`,
                {
                    input: {
                        id: activeChannel.id,
                        availableLanguageCodes: [...activeChannel.availableLanguageCodes, 'pl'],
                    },
                },
            );
            addedPlToChannel = true;
        }

        const { createCollection } = await client.gql(
            `mutation ($input: CreateCollectionInput!) { createCollection(input: $input) { id } }`,
            { input: { filters: [], translations: [{ languageCode: 'en', name, slug, description: '' }] } },
        );
        collectionId = createCollection.id;
        await page.close();
    });

    test.afterAll(async ({ browser }) => {
        const page = await browser.newPage();
        const client = new VendureAdminClient(page);
        await client.login();

        if (collectionId) {
            await client.gql(`mutation ($id: ID!) { deleteCollection(id: $id) { result } }`, {
                id: collectionId,
            });
        }
        if (addedPlToChannel) {
            const { activeChannel } = await client.gql(
                `query { activeChannel { id availableLanguageCodes } }`,
            );
            await client.gql(
                `mutation ($input: UpdateChannelInput!) {
                    updateChannel(input: $input) { ... on Channel { id } }
                }`,
                {
                    input: {
                        id: activeChannel.id,
                        availableLanguageCodes: activeChannel.availableLanguageCodes.filter(
                            (code: string) => code !== 'pl',
                        ),
                    },
                },
            );
        }
        if (addedPlGlobally) {
            const { globalSettings } = await client.gql(`query { globalSettings { availableLanguages } }`);
            await client.gql(
                `mutation ($input: UpdateGlobalSettingsInput!) {
                    updateGlobalSettings(input: $input) { ... on GlobalSettings { id } }
                }`,
                {
                    input: {
                        availableLanguages: globalSettings.availableLanguages.filter(
                            (code: string) => code !== 'pl',
                        ),
                    },
                },
            );
        }
        await page.close();
    });

    test('generates the slug of a new language on an existing collection', async ({ page }) => {
        const dp = detailPage(page);
        await dp.gotoExisting(collectionId);
        await expect(dp.formItem('Name').getByRole('textbox')).toHaveValue(name, { timeout: 10_000 });

        await switchContentLanguage(page, 'pl');
        await dp.fillInput('Name', plName);

        // Before the fix the slug input stayed empty here.
        await expect(dp.formItem('Slug').getByRole('textbox')).toHaveValue(plSlug, { timeout: 10_000 });

        await dp.clickUpdate();
        // The form is saved once Update is disabled again (the success toast auto-dismisses too fast).
        await expect(dp.updateButton).toBeDisabled({ timeout: 10_000 });

        const client = new VendureAdminClient(page);
        await client.login();
        const { collection } = await client.gql(
            `query ($id: ID!) { collection(id: $id) { translations { languageCode slug } } }`,
            { id: collectionId },
        );
        const pl = collection.translations.find((t: { languageCode: string }) => t.languageCode === 'pl');
        expect(pl?.slug).toBe(plSlug);
    });

    test('leaves an existing slug alone when the name changes', async ({ page }) => {
        const dp = detailPage(page);
        await dp.gotoExisting(collectionId);
        await expect(dp.formItem('Name').getByRole('textbox')).toHaveValue(name, { timeout: 10_000 });

        await dp.fillInput('Name', `${name} renamed`);
        // Outlive the 500ms generation debounce before asserting nothing changed.
        await page.waitForTimeout(1_500);
        await expect(dp.formItem('Slug').getByRole('textbox')).toHaveValue(slug);
    });
});
