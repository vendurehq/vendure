import { LanguageCode } from '@vendure/common/lib/generated-types';
import { pick } from '@vendure/common/lib/pick';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    getProductWithVariantsDocument,
    updateProductDocument,
    updateProductOptionGroupDocument,
} from './graphql/shared-definitions';

/* eslint-disable @typescript-eslint/no-non-null-assertion */
describe('Localization', () => {
    const { server, adminClient } = createTestEnvironment(testConfig());

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();

        const { updateProduct } = await adminClient.query(updateProductDocument, {
            input: {
                id: 'T_1',
                translations: [
                    {
                        languageCode: LanguageCode.en,
                        name: 'en name',
                        slug: 'en-slug',
                        description: 'en-description',
                    },
                    {
                        languageCode: LanguageCode.de,
                        name: 'de name',
                        slug: 'de-slug',
                        description: 'de-description',
                    },
                    {
                        languageCode: LanguageCode.zh,
                        name: 'zh name',
                        slug: 'zh-slug',
                        description: 'zh-description',
                    },
                ],
            },
        });

        await adminClient.query(updateProductOptionGroupDocument, {
            input: {
                id: 'T_1',
                translations: [
                    { languageCode: LanguageCode.en, name: 'en name' },
                    { languageCode: LanguageCode.de, name: 'de name' },
                    { languageCode: LanguageCode.zh, name: 'zh name' },
                ],
            },
        });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('returns default language when none specified', async () => {
        const { product } = await adminClient.query(getProductWithVariantsDocument, {
            id: 'T_1',
        });
        expect(pick(product!, ['name', 'slug', 'description'])).toEqual({
            name: 'en name',
            slug: 'en-slug',
            description: 'en-description',
        });
    });

    it('returns specified language', async () => {
        const { product } = await adminClient.query(
            getProductWithVariantsDocument,
            {
                id: 'T_1',
            },
            { languageCode: LanguageCode.de },
        );
        expect(pick(product!, ['name', 'slug', 'description'])).toEqual({
            name: 'de name',
            slug: 'de-slug',
            description: 'de-description',
        });
    });

    it('falls back to default language code', async () => {
        const { product } = await adminClient.query(
            getProductWithVariantsDocument,
            {
                id: 'T_1',
            },
            { languageCode: LanguageCode.ga },
        );
        expect(pick(product!, ['name', 'slug', 'description'])).toEqual({
            name: 'en name',
            slug: 'en-slug',
            description: 'en-description',
        });
    });

    it('nested entites are translated', async () => {
        const { product } = await adminClient.query(
            getProductWithVariantsDocument,
            {
                id: 'T_1',
            },
            { languageCode: LanguageCode.zh },
        );
        expect(pick(product!.optionGroups[0], ['name'])).toEqual({
            name: 'zh name',
        });
    });

    it('translates results of mutation', async () => {
        const { updateProduct } = await adminClient.query(
            updateProductDocument,
            {
                input: {
                    id: 'T_1',
                    enabled: true,
                },
            },
            { languageCode: LanguageCode.zh },
        );
        expect(updateProduct.name).toBe('zh name');
        expect(pick(updateProduct.optionGroups[0], ['name'])).toEqual({
            name: 'zh name',
        });
    });
});
