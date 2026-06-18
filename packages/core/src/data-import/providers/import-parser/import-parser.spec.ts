import { LanguageCode } from '@vendure/common/lib/generated-types';
import fs from 'fs-extra';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';

import { ensureConfigLoaded } from '../../../config/config-helpers';
import { ConfigService } from '../../../config/config.service';

import { ImportParser } from './import-parser';

const mockConfigService = {
    defaultLanguageCode: LanguageCode.en,
    customFields: {
        Product: [
            {
                name: 'keywords',
                type: 'localeString',
                list: true,
            },
            {
                name: 'customPage',
                type: 'string',
            },
        ],
        ProductVariant: [
            {
                name: 'volumetric',
                type: 'int',
            },
        ],
    },
} as ConfigService;

describe('ImportParser', () => {
    beforeAll(async () => {
        await ensureConfigLoaded();
    });

    describe('parseProducts', () => {
        it('single product with a single variant', async () => {
            const importParser = new ImportParser(mockConfigService);

            const input = await loadTestFixture('single-product-single-variant.csv');
            const result = await importParser.parseProducts(input);

            expect(result.results).toMatchSnapshot();
        });

        it('single product with a multiple variants', async () => {
            const importParser = new ImportParser(mockConfigService);

            const input = await loadTestFixture('single-product-multiple-variants.csv');
            const result = await importParser.parseProducts(input);

            expect(result.results).toMatchSnapshot();
        });

        it('multiple products with multiple variants', async () => {
            const importParser = new ImportParser(mockConfigService);

            const input = await loadTestFixture('multiple-products-multiple-variants.csv');
            const result = await importParser.parseProducts(input);

            expect(result.results).toMatchSnapshot();
        });

        it('custom fields', async () => {
            const importParser = new ImportParser(mockConfigService);

            const input = await loadTestFixture('custom-fields.csv');
            const result = await importParser.parseProducts(input);

            expect(result.results).toMatchSnapshot();
        });

        it('works with streamed input', async () => {
            const importParser = new ImportParser(mockConfigService);

            const filename = path.join(__dirname, 'test-fixtures', 'multiple-products-multiple-variants.csv');
            const input = fs.createReadStream(filename);
            const result = await importParser.parseProducts(input);

            expect(result.results).toMatchSnapshot();
        });

        it('works with multilingual input', async () => {
            const importParser = new ImportParser(mockConfigService);

            const filename = path.join(__dirname, 'test-fixtures', 'multiple-languages.csv');
            const input = fs.createReadStream(filename);
            const result = await importParser.parseProducts(input);

            expect(result.results).toMatchSnapshot();
        });

        it('parses option group with explicit code syntax', async () => {
            const importParser = new ImportParser(mockConfigService);

            const input = await loadTestFixture('option-group-with-codes.csv');
            const result = await importParser.parseProducts(input);

            expect(result.errors).toEqual([]);
            expect(result.results.length).toBe(1);

            const product = result.results[0].product;
            expect(product.optionGroups.length).toBe(2);

            // First group: "size:tshirt-size" should have code "tshirt-size" and name "size"
            expect(product.optionGroups[0].code).toBe('tshirt-size');
            expect(product.optionGroups[0].translations[0].name).toBe('size');
            expect(product.optionGroups[0].translations[0].values).toEqual(['Small', 'Large']);

            // Second group: "color" should have no explicit code
            expect(product.optionGroups[1].code).toBeUndefined();
            expect(product.optionGroups[1].translations[0].name).toBe('color');
            expect(product.optionGroups[1].translations[0].values).toEqual(['Red', 'Blue']);
        });

        describe('error conditions', () => {
            it('reports errors on invalid option values', async () => {
                const importParser = new ImportParser(mockConfigService);

                const input = await loadTestFixture('invalid-option-values.csv');
                const result = await importParser.parseProducts(input);

                expect(result.errors).toEqual([
                    "The number of optionValues in column 'optionValues' must match the number of optionGroups on line 2",
                    "The number of optionValues in column 'optionValues' must match the number of optionGroups on line 3",
                    "The number of optionValues in column 'optionValues' must match the number of optionGroups on line 4",
                    "The number of optionValues in column 'optionValues' must match the number of optionGroups on line 5",
                ]);
            });

            it('reports error on ivalid columns', async () => {
                const importParser = new ImportParser(mockConfigService);

                const input = await loadTestFixture('invalid-columns.csv');
                const result = await importParser.parseProducts(input);

                expect(result.results).toEqual([]);
                expect(result.errors).toEqual([
                    'The import file is missing the following columns: "slug", "assets", "variantFacets"',
                ]);
            });

            it('reports error on ivalid row length', async () => {
                const importParser = new ImportParser(mockConfigService);

                const input = await loadTestFixture('invalid-row-length.csv');
                const result = await importParser.parseProducts(input);

                expect(result.errors).toEqual([
                    'Invalid Record Length: header length is 14, got 12 on line 3',
                    'Invalid Record Length: header length is 14, got 1 on line 4',
                ]);
                expect(result.results.length).toBe(2);
            });
        });
    });
});

function loadTestFixture(fileName: string): Promise<string> {
    return fs.readFile(path.join(__dirname, 'test-fixtures', fileName), 'utf-8');
}
