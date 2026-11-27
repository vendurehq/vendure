/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { DeletionResult, LanguageCode } from '@vendure/common/lib/generated-types';
import { pick } from '@vendure/common/lib/pick';
import { CustomerGroup, Province, TransactionalConnection } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { createCountryDocument, deleteCountryDocument } from './graphql/admin-definitions';
import {
    createCustomerGroupDocument,
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
        expect(taxRate!.zone?.name).toBe('Oceania');
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

    // PR #5176: CustomerGroup.taxRates should resolve through TaxRate.customerGroup, not TaxRate.zone
    it('CustomerGroup.taxRates relation returns the rates assigned to the group', async () => {
        const { createCustomerGroup } = await adminClient.query(createCustomerGroupDocument, {
            input: { name: 'Tax Rate Group', customerIds: [] },
        });
        await adminClient.query(createTaxRateDocument, {
            input: {
                name: 'Group Tax Rate',
                categoryId: 'T_1',
                zoneId: 'T_2',
                customerGroupId: createCustomerGroup.id,
                enabled: true,
                value: 5,
            },
        });

        const group = await server.app
            .get(TransactionalConnection)
            .rawConnection.getRepository(CustomerGroup)
            .findOne({ where: { name: 'Tax Rate Group' }, relations: { taxRates: true } });

        expect(group!.taxRates.map(t => t.name)).toEqual(['Group Tax Rate']);
    });

    describe('target validation', () => {
        let germanyId: string;
        let provinceId: string;

        beforeAll(async () => {
            const { createCountry } = await adminClient.query(createCountryDocument, {
                input: {
                    code: 'DE',
                    enabled: true,
                    translations: [{ languageCode: LanguageCode.en, name: 'Germany' }],
                },
            });
            germanyId = createCountry.id;
            // There is no Admin API mutation for provinces yet, so save one directly.
            const province = await server.app
                .get(TransactionalConnection)
                .rawConnection.getRepository(Province)
                .save(new Province({ code: 'BY', type: 'province', enabled: true }));
            provinceId = province.id as string;
        });

        it('creates a rate that targets a country', async () => {
            const { createTaxRate } = await adminClient.query(createTaxRateDocument, {
                input: { name: 'DE', categoryId: 'T_1', regionId: germanyId, enabled: true, value: 19 },
            });
            expect(createTaxRate.region?.code).toBe('DE');
            expect(createTaxRate.zone).toBeNull();
        });

        it('rejects a rate with both a zone and a region', async () => {
            await expect(
                adminClient.query(createTaxRateDocument, {
                    input: {
                        name: 'both',
                        categoryId: 'T_1',
                        zoneId: 'T_1',
                        regionId: germanyId,
                        enabled: true,
                        value: 19,
                    },
                }),
            ).rejects.toThrow('exactly one of zoneId or regionId');
        });

        it('rejects a rate with neither a zone nor a region', async () => {
            await expect(
                adminClient.query(createTaxRateDocument, {
                    input: { name: 'none', categoryId: 'T_1', enabled: true, value: 19 },
                }),
            ).rejects.toThrow('exactly one of zoneId or regionId');
        });

        it('rejects a region that is not a country', async () => {
            await expect(
                adminClient.query(createTaxRateDocument, {
                    input: {
                        name: 'province',
                        categoryId: 'T_1',
                        regionId: provinceId,
                        enabled: true,
                        value: 19,
                    },
                }),
            ).rejects.toThrow('only target a Region of type "country"');
        });

        it('update switches the target from a zone to a country', async () => {
            const { createTaxRate } = await adminClient.query(createTaxRateDocument, {
                input: { name: 'switch', categoryId: 'T_1', zoneId: 'T_1', enabled: true, value: 5 },
            });
            const { updateTaxRate } = await adminClient.query(updateTaxRateDocument, {
                input: { id: createTaxRate.id, regionId: germanyId },
            });
            expect(updateTaxRate.region?.code).toBe('DE');
            expect(updateTaxRate.zone).toBeNull();
        });

        it('update rejects both a zone and a region', async () => {
            const { taxRates } = await adminClient.query(getTaxRatesListDocument, {
                options: { filter: { name: { eq: 'switch' } } },
            });
            await expect(
                adminClient.query(updateTaxRateDocument, {
                    input: { id: taxRates.items[0].id, zoneId: 'T_1', regionId: germanyId },
                }),
            ).rejects.toThrow('exactly one of zoneId or regionId');
        });

        it('update rejects removing the only target', async () => {
            const { taxRates } = await adminClient.query(getTaxRatesListDocument, {
                options: { filter: { name: { in: ['DE', 'Standard Tax Oceania'] } } },
            });
            const countryRate = taxRates.items.find(r => r.name === 'DE')!;
            const zoneRate = taxRates.items.find(r => r.name === 'Standard Tax Oceania')!;
            await expect(
                adminClient.query(updateTaxRateDocument, { input: { id: countryRate.id, regionId: null } }),
            ).rejects.toThrow('exactly one of zoneId or regionId');
            await expect(
                adminClient.query(updateTaxRateDocument, { input: { id: zoneRate.id, zoneId: null } }),
            ).rejects.toThrow('exactly one of zoneId or regionId');
        });

        it('a country used by a tax rate cannot be deleted', async () => {
            const { deleteCountry } = await adminClient.query(deleteCountryDocument, { id: germanyId });
            expect(deleteCountry.result).toBe(DeletionResult.NOT_DELETED);
            expect(deleteCountry.message).toBe(
                'The selected Country cannot be deleted as it is used in the following TaxRates: DE, switch',
            );
        });

        it('filters by regionId', async () => {
            const { taxRates } = await adminClient.query(getTaxRatesListDocument, {
                options: { filter: { regionId: { eq: germanyId } } },
            });
            expect(taxRates.items.map(r => r.name).sort()).toEqual(['DE', 'switch']);
        });

        it('update switches the target from a country back to a zone', async () => {
            const { taxRates } = await adminClient.query(getTaxRatesListDocument, {
                options: { filter: { name: { eq: 'switch' } } },
            });
            const { updateTaxRate } = await adminClient.query(updateTaxRateDocument, {
                input: { id: taxRates.items[0].id, zoneId: 'T_1' },
            });
            expect(updateTaxRate.zone?.id).toBe('T_1');
            expect(updateTaxRate.region).toBeNull();
        });
    });
});
