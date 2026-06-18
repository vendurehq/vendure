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
});
