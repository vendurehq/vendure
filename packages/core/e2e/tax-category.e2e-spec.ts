import { DeletionResult } from '@vendure/common/lib/generated-types';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    createTaxCategoryDocument,
    deleteTaxCategoryDocument,
    getTaxCategoryDocument,
    getTaxCategoryListDocument,
    updateTaxCategoryDocument,
} from './graphql/admin-definitions';
import { sortById } from './utils/test-order-utils';

describe('TaxCategory resolver', () => {
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

    it('taxCategories', async () => {
        const { taxCategories } = await adminClient.query(getTaxCategoryListDocument);

        expect(taxCategories.items.sort(sortById)).toEqual([
            { id: 'T_1', name: 'Standard Tax', isDefault: false },
            { id: 'T_2', name: 'Reduced Tax', isDefault: false },
            { id: 'T_3', name: 'Zero Tax', isDefault: false },
        ]);
    });

    it('taxCategory', async () => {
        const { taxCategory } = await adminClient.query(getTaxCategoryDocument, {
            id: 'T_2',
        });

        expect(taxCategory).toEqual({
            id: 'T_2',
            name: 'Reduced Tax',
            isDefault: false,
        });
    });

    it('createTaxCategory', async () => {
        const { createTaxCategory } = await adminClient.query(createTaxCategoryDocument, {
            input: {
                name: 'New Category',
            },
        });

        expect(createTaxCategory).toEqual({
            id: 'T_4',
            name: 'New Category',
            isDefault: false,
        });
    });

    it('updateCategory', async () => {
        const { updateTaxCategory } = await adminClient.query(updateTaxCategoryDocument, {
            input: {
                id: 'T_4',
                name: 'New Category Updated',
            },
        });

        expect(updateTaxCategory).toEqual({
            id: 'T_4',
            name: 'New Category Updated',
            isDefault: false,
        });
    });

    it('set default', async () => {
        const { updateTaxCategory } = await adminClient.query(updateTaxCategoryDocument, {
            input: {
                id: 'T_2',
                isDefault: true,
            },
        });

        expect(updateTaxCategory).toEqual({
            id: 'T_2',
            name: 'Reduced Tax',
            isDefault: true,
        });

        const { taxCategories } = await adminClient.query(getTaxCategoryListDocument);
        expect(taxCategories.items.sort(sortById)).toEqual([
            { id: 'T_1', name: 'Standard Tax', isDefault: false },
            { id: 'T_2', name: 'Reduced Tax', isDefault: true },
            { id: 'T_3', name: 'Zero Tax', isDefault: false },
            { id: 'T_4', name: 'New Category Updated', isDefault: false },
        ]);
    });

    it('set a different default', async () => {
        const { updateTaxCategory } = await adminClient.query(updateTaxCategoryDocument, {
            input: {
                id: 'T_1',
                isDefault: true,
            },
        });

        expect(updateTaxCategory).toEqual({
            id: 'T_1',
            name: 'Standard Tax',
            isDefault: true,
        });

        const { taxCategories } = await adminClient.query(getTaxCategoryListDocument);
        expect(taxCategories.items.sort(sortById)).toEqual([
            { id: 'T_1', name: 'Standard Tax', isDefault: true },
            { id: 'T_2', name: 'Reduced Tax', isDefault: false },
            { id: 'T_3', name: 'Zero Tax', isDefault: false },
            { id: 'T_4', name: 'New Category Updated', isDefault: false },
        ]);
    });

    describe('deletion', () => {
        it('cannot delete if used by a TaxRate', async () => {
            const { deleteTaxCategory } = await adminClient.query(deleteTaxCategoryDocument, {
                id: 'T_2',
            });

            expect(deleteTaxCategory.result).toBe(DeletionResult.NOT_DELETED);
            expect(deleteTaxCategory.message).toBe(
                'Cannot remove TaxCategory "Reduced Tax" as it is referenced by 5 TaxRates',
            );
        });

        it('can delete if not used by TaxRate', async () => {
            const { deleteTaxCategory } = await adminClient.query(deleteTaxCategoryDocument, {
                id: 'T_4',
            });

            expect(deleteTaxCategory.result).toBe(DeletionResult.DELETED);
            expect(deleteTaxCategory.message).toBeNull();

            const { taxCategory } = await adminClient.query(getTaxCategoryDocument, {
                id: 'T_4',
            });

            expect(taxCategory).toBeNull();
        });
    });
});
