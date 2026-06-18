import { Type } from '@vendure/common/lib/shared-types';
import { fail } from 'assert';
import { DefaultNamingStrategy } from 'typeorm';
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata';
import { RelationMetadata } from 'typeorm/metadata/RelationMetadata';
import { describe, expect, it } from 'vitest';

import { SortParameter } from '../../../common/types/common-types';
import { CustomFieldConfig } from '../../../config/custom-field/custom-field-types';
import { ProductTranslation } from '../../../entity/product/product-translation.entity';
import { Product } from '../../../entity/product/product.entity';
import { I18nError } from '../../../i18n/i18n-error';

import { parseSortParams } from './parse-sort-params';

describe('parseSortParams()', () => {
    it('works with no params', () => {
        const connection = new MockConnection();
        connection.setColumns(Product, [{ propertyName: 'id' }, { propertyName: 'image' }]);

        const result = parseSortParams(connection as any, Product, {});
        expect(result).toEqual({});
    });

    it('works with a single param', () => {
        const connection = new MockConnection();
        connection.setColumns(Product, [{ propertyName: 'id' }, { propertyName: 'image' }]);

        const sortParams: SortParameter<Product> = {
            id: 'ASC',
        };

        const result = parseSortParams(connection as any, Product, sortParams);
        expect(result).toEqual({
            'product.id': 'ASC',
        });
    });

    it('works with multiple params', () => {
        const connection = new MockConnection();
        connection.setColumns(Product, [
            { propertyName: 'id' },
            { propertyName: 'image' },
            { propertyName: 'createdAt' },
        ]);

        const sortParams: SortParameter<Product> = {
            id: 'ASC',
            createdAt: 'DESC',
        };

        const result = parseSortParams(connection as any, Product, sortParams);
        expect(result).toEqual({
            'product.id': 'ASC',
            'product.createdAt': 'DESC',
        });
    });

    it('works with localized fields', () => {
        const connection = new MockConnection();
        connection.setColumns(Product, [{ propertyName: 'id' }, { propertyName: 'image' }]);
        connection.setRelations(Product, [{ propertyName: 'translations', type: ProductTranslation }]);
        connection.setColumns(ProductTranslation, [
            { propertyName: 'id' },
            { propertyName: 'name' },
            { propertyName: 'base', relationMetadata: {} as any },
        ]);

        const sortParams: SortParameter<Product> = {
            id: 'ASC',
            name: 'DESC',
        };

        const result = parseSortParams(connection as any, Product, sortParams);
        expect(result).toEqual({
            'product.id': 'ASC',
            'product__translations.name': 'DESC',
        });
    });

    it('works with custom fields', () => {
        const connection = new MockConnection();
        connection.setColumns(Product, [{ propertyName: 'id' }, { propertyName: 'infoUrl' }]);

        const sortParams: SortParameter<Product & { infoUrl: any }> = {
            infoUrl: 'ASC',
        };

        const result = parseSortParams(connection as any, Product, sortParams);
        expect(result).toEqual({
            'product.infoUrl': 'ASC',
        });
    });

    it('works with localized custom fields', () => {
        const connection = new MockConnection();
        connection.setColumns(Product, [{ propertyName: 'id' }]);
        connection.setRelations(Product, [{ propertyName: 'translations', type: ProductTranslation }]);
        connection.setColumns(ProductTranslation, [{ propertyName: 'id' }, { propertyName: 'shortName' }]);

        const sortParams: SortParameter<Product & { shortName: any }> = {
            shortName: 'ASC',
        };
        const productCustomFields: CustomFieldConfig[] = [{ name: 'shortName', type: 'localeString' }];

        const result = parseSortParams(
            connection as any,
            Product,
            sortParams,
            {},
            undefined,
            productCustomFields,
        );
        expect(result).toEqual({
            'product__translations.customFields.shortName': 'ASC',
        });
    });

    it('throws if an invalid field is passed', () => {
        const connection = new MockConnection();
        connection.setColumns(Product, [{ propertyName: 'id' }, { propertyName: 'image' }]);
        connection.setRelations(Product, [{ propertyName: 'translations', type: ProductTranslation }]);
        connection.setColumns(ProductTranslation, [
            { propertyName: 'id' },
            { propertyName: 'name' },
            { propertyName: 'base', relationMetadata: {} as any },
        ]);

        const sortParams: SortParameter<Product & { invalid: any }> = {
            invalid: 'ASC',
        };

        try {
            parseSortParams(connection as any, Product, sortParams);
            fail('should not get here');
        } catch (e: any) {
            expect(e instanceof I18nError).toBe(true);
            expect(e.message).toBe('error.invalid-sort-field');
            expect(e.variables.fieldName).toBe('invalid');
            expect(e.variables.validFields).toEqual('id, image, name');
        }
    });
});

export class MockConnection {
    private columnsMap = new Map<Type<any>, Array<Partial<ColumnMetadata>>>();
    private relationsMap = new Map<Type<any>, Array<Partial<RelationMetadata>>>();
    setColumns(entity: Type<any>, value: Array<Partial<ColumnMetadata>>) {
        value.forEach(v => (v.propertyPath = v.propertyName));
        this.columnsMap.set(entity, value);
    }
    setRelations(entity: Type<any>, value: Array<Partial<RelationMetadata>>) {
        this.relationsMap.set(entity, value);
    }
    getMetadata = (entity: Type<any>) => {
        return {
            name: entity.name,
            columns: this.columnsMap.get(entity) || [],
            relations: this.relationsMap.get(entity) || [],
        };
    };
    namingStrategy = new DefaultNamingStrategy();
    readonly options = {
        type: 'sqljs',
    };
}
