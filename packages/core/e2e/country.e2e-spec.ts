import { DeletionResult, LanguageCode } from '@vendure/common/lib/generated-types';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    createCountryDocument,
    deleteCountryDocument,
    getCountryDocument,
} from './graphql/admin-definitions';
import { ResultOf } from './graphql/graphql-admin';
import { getCountryListDocument, updateCountryDocument } from './graphql/shared-definitions';

/* eslint-disable @typescript-eslint/no-non-null-assertion */

describe('Country resolver', () => {
    const { server, adminClient } = createTestEnvironment(testConfig());
    let countries: ResultOf<typeof getCountryListDocument>['countries']['items'];
    let GB: ResultOf<typeof getCountryListDocument>['countries']['items'][number];
    let AT: ResultOf<typeof getCountryListDocument>['countries']['items'][number];

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('countries', async () => {
        const result = await adminClient.query(getCountryListDocument, {});

        expect(result.countries.totalItems).toBe(7);
        countries = result.countries.items;
        GB = countries.find(c => c.code === 'GB')!;
        AT = countries.find(c => c.code === 'AT')!;
    });

    it('country', async () => {
        const result = await adminClient.query(getCountryDocument, {
            id: GB.id,
        });

        expect(result.country!.name).toBe(GB.name);
    });

    it('updateCountry', async () => {
        const result = await adminClient.query(updateCountryDocument, {
            input: {
                id: AT.id,
                enabled: false,
            },
        });

        expect(result.updateCountry.enabled).toBe(false);
    });

    it('createCountry', async () => {
        const result = await adminClient.query(createCountryDocument, {
            input: {
                code: 'GL',
                enabled: true,
                translations: [{ languageCode: LanguageCode.en, name: 'Gondwanaland' }],
            },
        });

        expect(result.createCountry.name).toBe('Gondwanaland');
    });

    describe('deletion', () => {
        it('deletes Country not used in any address', async () => {
            const result1 = await adminClient.query(deleteCountryDocument, { id: AT.id });

            expect(result1.deleteCountry).toEqual({
                result: DeletionResult.DELETED,
                message: '',
            });

            const result2 = await adminClient.query(getCountryListDocument, {});
            expect(result2.countries.items.find(c => c.id === AT.id)).toBeUndefined();
        });

        it('does not delete Country that is used in one or more addresses', async () => {
            const result1 = await adminClient.query(deleteCountryDocument, { id: GB.id });

            expect(result1.deleteCountry).toEqual({
                result: DeletionResult.NOT_DELETED,
                message: 'The selected Country cannot be deleted as it is used in 1 Address',
            });

            const result2 = await adminClient.query(getCountryListDocument, {});
            expect(result2.countries.items.find(c => c.id === GB.id)).not.toBeUndefined();
        });
    });
});
