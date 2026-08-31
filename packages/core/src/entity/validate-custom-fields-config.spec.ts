import { Type } from '@vendure/common/lib/shared-types';
import { describe, expect, it } from 'vitest';

import { CustomFields } from '../config/custom-field/custom-field-types';

import { coreEntitiesMap } from './entities';
import { validateCustomFieldsConfig } from './validate-custom-fields-config';

describe('validateCustomFieldsConfig()', () => {
    const allEntities = Object.values(coreEntitiesMap) as Array<Type<any>>;

    it('valid config', () => {
        const config: CustomFields = {
            Product: [
                { name: 'foo', type: 'string' },
                { name: 'bar', type: 'localeString' },
            ],
        };
        const result = validateCustomFieldsConfig(config, allEntities);

        expect(result.valid).toBe(true);
        expect(result.errors.length).toBe(0);
    });

    it('invalid localeString', () => {
        const config: CustomFields = {
            User: [
                { name: 'foo', type: 'string' },
                { name: 'bar', type: 'localeString' },
            ],
        };
        const result = validateCustomFieldsConfig(config, allEntities);

        expect(result.valid).toBe(false);
        expect(result.errors).toEqual(['User entity does not support custom fields of type "localeString"']);
    });

    it('valid names', () => {
        const config: CustomFields = {
            User: [
                { name: 'love2code', type: 'string' },
                { name: 'snake_case', type: 'string' },
                { name: 'camelCase', type: 'string' },
                { name: 'SHOUTY', type: 'string' },
            ],
        };
        const result = validateCustomFieldsConfig(config, allEntities);

        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
    });

    it('invalid names', () => {
        const config: CustomFields = {
            User: [
                { name: '2cool', type: 'string' },
                { name: 'has space', type: 'string' },
                { name: 'speci@alChar', type: 'string' },
                { name: 'has-dash', type: 'string' },
            ],
        };
        const result = validateCustomFieldsConfig(config, allEntities);

        expect(result.valid).toBe(false);
        expect(result.errors).toEqual([
            'User entity has an invalid custom field name: "2cool"',
            'User entity has an invalid custom field name: "has space"',
            'User entity has an invalid custom field name: "speci@alChar"',
            'User entity has an invalid custom field name: "has-dash"',
        ]);
    });

    it('duplicate names', () => {
        const config: CustomFields = {
            User: [
                { name: 'foo', type: 'string' },
                { name: 'bar', type: 'string' },
                { name: 'baz', type: 'string' },
                { name: 'foo', type: 'boolean' },
                { name: 'bar', type: 'boolean' },
            ],
        };
        const result = validateCustomFieldsConfig(config, allEntities);

        expect(result.valid).toBe(false);
        expect(result.errors).toEqual([
            'User entity has duplicated custom field name: "foo"',
            'User entity has duplicated custom field name: "bar"',
        ]);
    });

    it('duplicate names in translation', () => {
        const config: CustomFields = {
            Product: [
                { name: 'foo', type: 'string' },
                { name: 'bar', type: 'string' },
                { name: 'baz', type: 'string' },
                { name: 'foo', type: 'localeString' },
                { name: 'bar', type: 'boolean' },
            ],
        };
        const result = validateCustomFieldsConfig(config, allEntities);

        expect(result.valid).toBe(false);
        expect(result.errors).toEqual([
            'Product entity has duplicated custom field name: "foo"',
            'Product entity has duplicated custom field name: "bar"',
        ]);
    });

    it('name conflict with existing fields', () => {
        const config: CustomFields = {
            Product: [{ name: 'createdAt', type: 'string' }],
        };
        const result = validateCustomFieldsConfig(config, allEntities);

        expect(result.valid).toBe(false);
        expect(result.errors).toEqual(['Product entity already has a field named "createdAt"']);
    });

    it('name conflict with existing fields in translation', () => {
        const config: CustomFields = {
            Product: [{ name: 'name', type: 'string' }],
        };
        const result = validateCustomFieldsConfig(config, allEntities);

        expect(result.valid).toBe(false);
        expect(result.errors).toEqual(['Product entity already has a field named "name"']);
    });

    it('name conflict with relation id property', () => {
        const config: CustomFields = {
            Product: [
                { name: 'owner', type: 'relation', entity: coreEntitiesMap.User, list: false },
                { name: 'ownerId', type: 'string' },
            ],
        };
        const result = validateCustomFieldsConfig(config, allEntities);

        expect(result.valid).toBe(false);
        expect(result.errors).toEqual([
            'Product entity has a custom field "ownerId" which conflicts with the id property of the relation custom field "owner"',
        ]);
    });

    it('name conflict with list relation id property', () => {
        const config: CustomFields = {
            Product: [
                { name: 'owner', type: 'relation', entity: coreEntitiesMap.User, list: true },
                { name: 'ownerIds', type: 'string' },
            ],
        };
        const result = validateCustomFieldsConfig(config, allEntities);

        expect(result.valid).toBe(false);
        expect(result.errors).toEqual([
            'Product entity has a custom field "ownerIds" which conflicts with the id property of the relation custom field "owner"',
        ]);
    });

    it('non-nullable must have defaultValue', () => {
        const config: CustomFields = {
            Product: [{ name: 'foo', type: 'string', nullable: false }],
        };
        const result = validateCustomFieldsConfig(config, allEntities);

        expect(result.valid).toBe(false);
        expect(result.errors).toEqual([
            'Product entity custom field "foo" is non-nullable and must have a defaultValue',
        ]);
    });

    it('rejects an index on a list field assembled dynamically', () => {
        const fields = [{ name: 'tags', type: 'string', list: true, index: true }];
        const config: CustomFields = { Product: fields as CustomFields['Product'] };
        const result = validateCustomFieldsConfig(config, allEntities, 'postgres');

        expect(result.valid).toBe(false);
        expect(result.errors).toEqual([
            'Product entity custom field "tags" cannot be indexed because list fields are stored as JSON',
        ]);
    });

    it('rejects an index on a struct field assembled dynamically', () => {
        const fields = [
            {
                name: 'dimensions',
                type: 'struct',
                index: true,
                fields: [{ name: 'width', type: 'int' }],
            },
        ];
        const config: CustomFields = { Product: fields as CustomFields['Product'] };
        const result = validateCustomFieldsConfig(config, allEntities, 'postgres');

        expect(result.valid).toBe(false);
        expect(result.errors).toEqual([
            'Product entity custom field "dimensions" cannot be indexed because struct fields are stored as JSON',
        ]);
    });

    it('rejects an index on a secret field', () => {
        const config: CustomFields = {
            Product: [{ name: 'token', type: 'string', secret: true, index: true }],
        };
        const result = validateCustomFieldsConfig(config, allEntities, 'postgres');

        expect(result.valid).toBe(false);
        expect(result.errors).toEqual([
            'Product entity custom field "token" cannot be indexed because secret fields are stored as encrypted unbounded text',
        ]);
    });

    it.each(['mysql', 'mariadb'] as const)(
        'rejects indexes and unique constraints on text fields for %s',
        dbEngine => {
            const config: CustomFields = {
                Product: [
                    { name: 'indexedNotes', type: 'text', index: true },
                    { name: 'uniqueNotes', type: 'text', unique: true },
                ],
            };
            const result = validateCustomFieldsConfig(config, allEntities, dbEngine);

            expect(result.valid).toBe(false);
            expect(result.errors).toEqual([
                `Product entity custom field "indexedNotes" cannot be indexed or unique on ${dbEngine} because text fields are stored as longtext`,
                `Product entity custom field "uniqueNotes" cannot be indexed or unique on ${dbEngine} because text fields are stored as longtext`,
            ]);
        },
    );

    it('allows an index on a text field for postgres', () => {
        const config: CustomFields = {
            Product: [{ name: 'notes', type: 'text', index: true }],
        };
        const result = validateCustomFieldsConfig(config, allEntities, 'postgres');

        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
    });
});
