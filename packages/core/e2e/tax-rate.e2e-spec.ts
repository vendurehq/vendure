/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { DeletionResult } from '@vendure/common/lib/generated-types';
import { pick } from '@vendure/common/lib/pick';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    createTaxRateDocument,
    deleteTaxRateDocument,
    getTaxRateDocument,
    getTaxRatesListDocument,
    updateTaxRateDocument,
} from './graphql/shared-definitions';

describe('TaxRate resolver', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(testConfig());

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 2,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('taxRates list', async () => {
        const { taxRates } = await adminClient.query(getTaxRatesListDocument);

        expect(taxRates.totalItems).toBe(15);
    });

    it('taxRate', async () => {
        const { taxRate } = await adminClient.query(getTaxRateDocument, {
            id: 'T_1',
        });

        expect(pick(taxRate!, ['id', 'name', 'enabled', 'value'])).toEqual({
            id: 'T_1',
            name: 'Standard Tax Oceania',
            enabled: true,
            value: 20,
        });
        expect(taxRate!.category.name).toBe('Standard Tax');
        expect(taxRate!.zone.name).toBe('Oceania');
    });

    it('createTaxRate', async () => {
        const { createTaxRate } = await adminClient.query(createTaxRateDocument, {
            input: {
                name: 'My Tax Rate',
                categoryId: 'T_1',
                zoneId: 'T_1',
                enabled: true,
                value: 17.5,
            },
        });

        expect(createTaxRate.name).toBe('My Tax Rate');
        expect(createTaxRate.value).toBe(17.5);
    });

    it('updateTaxRate', async () => {
        const { updateTaxRate } = await adminClient.query(updateTaxRateDocument, {
            input: {
                id: 'T_1',
                value: 17.5,
            },
        });

        expect(updateTaxRate.value).toBe(17.5);
    });

    it('deleteTaxRate', async () => {
        const { deleteTaxRate } = await adminClient.query(deleteTaxRateDocument, {
            id: 'T_3',
        });

        expect(deleteTaxRate.result).toBe(DeletionResult.DELETED);
        expect(deleteTaxRate.message).toBeNull();

        const { taxRates } = await adminClient.query(getTaxRatesListDocument);
        expect(taxRates.items.find(x => x.id === 'T_3')).toBeUndefined();
    });
});
