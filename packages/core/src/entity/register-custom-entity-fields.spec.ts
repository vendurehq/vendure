import { DeepPartial } from '@vendure/common/lib/shared-types';
import { getMetadataArgsStorage } from 'typeorm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Logger } from '../config';
import { CustomFields } from '../config/custom-field/custom-field-types';
import { VendureConfig } from '../config/vendure-config';

import { Asset } from './asset/asset.entity';
import { VendureEntity } from './base/base.entity';
import { registerCustomEntityFields } from './register-custom-entity-fields';

const SINGLE_RELATION_FIELD = '__testRelationOptionsSingle__';
const LIST_RELATION_FIELD = '__testRelationOptionsList__';
const NON_RELATION_FIELD = '__testRelationOptionsNonRelation__';

class TestEntity extends VendureEntity {
        constructor(input?: DeepPartial<TestEntity>) {
            super(input);
        }
    customFields: any;
}

describe('registerCustomEntityFields() relation options', () => {
    let mockLoggerWarn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        mockLoggerWarn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
        removeTestMetadata();
        mockLoggerWarn.mockRestore();
    });

    it('applies cascade/onDelete/onUpdate/eager/nullable on many-to-one relation custom fields', () => {
        registerCustomEntityFields(
            createConfig({
                Product: [
                    { name: NON_RELATION_FIELD, type: 'string' },
                    {
                        name: SINGLE_RELATION_FIELD,
                        type: 'relation',
                        entity: TestEntity,
                        cascade: true,
                        onDelete: 'SET NULL',
                        onUpdate: 'CASCADE',
                        eager: true,
                        nullable: true,
                    },
                ],
            }),
        );

        const relation = getMetadataArgsStorage()
            .filterRelations(getProductCustomFieldsClass())
            .find(r => r.propertyName === SINGLE_RELATION_FIELD);

        expect(relation?.relationType).toBe('many-to-one');
        expect(relation?.options).toEqual({
            cascade: true,
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
            eager: true,
            nullable: true,
        });
    });

    it('applies cascade/onDelete/onUpdate/eager on many-to-many relation custom fields', () => {
        registerCustomEntityFields(
            createConfig({
                Product: [
                    { name: NON_RELATION_FIELD, type: 'string' },
                    {
                        name: LIST_RELATION_FIELD,
                        type: 'relation',
                        list: true,
                        entity: TestEntity,
                        cascade: ['insert', 'update'],
                        onDelete: 'CASCADE',
                        onUpdate: 'RESTRICT',
                        eager: false,
                    },
                ],
            }),
        );

        const relation = getMetadataArgsStorage()
            .filterRelations(getProductCustomFieldsClass())
            .find(r => r.propertyName === LIST_RELATION_FIELD);

        expect(relation?.relationType).toBe('many-to-many');
        expect(relation?.options).toEqual({
            cascade: ['insert', 'update'],
            onDelete: 'CASCADE',
            onUpdate: 'RESTRICT',
            eager: false,
        });
    });

    it('applies default options on relation custom fields', () => {
        registerCustomEntityFields(
            createConfig({
                Product: [
                    { name: NON_RELATION_FIELD, type: 'string' },
                    {
                        name: LIST_RELATION_FIELD,
                        type: 'relation',
                        entity: TestEntity,
                    },
                ],
            }),
        );

        const relation = getMetadataArgsStorage()
            .filterRelations(getProductCustomFieldsClass())
            .find(r => r.propertyName === LIST_RELATION_FIELD);

        expect(relation?.relationType).toBe('many-to-one');
        expect(relation?.options).toEqual({
            cascade: undefined,
            onDelete: undefined,
            onUpdate: undefined,
            eager: undefined,
        });
    });

    it('warns if onDelete: \'CASCADE\' is affecting core Vendure entities', () => {
        registerCustomEntityFields(
            createConfig({
                Product: [
                    { name: NON_RELATION_FIELD, type: 'string' },
                    {
                        name: LIST_RELATION_FIELD,
                        type: 'relation',
                        list: false,
                        entity: Asset,
                        onDelete: 'CASCADE',
                        eager: false,
                    },
                ],
            }),
        );

        expect(mockLoggerWarn).toHaveBeenCalledWith(
            [
                `WARNING: You have set "onDelete: 'CASCADE'" on a custom field relation to the "Asset" entity.`,
                `With this FK behavior, deleting a "Asset" row can delete owning rows that reference it.`,
                `Please verify this is intended, especially when targeting core Vendure entities.`,
            ].join('\n'),
        );
    });

    it('warns if cascade: ["remove"] is affecting core Vendure entities', () => {
        registerCustomEntityFields(
            createConfig({
                Product: [
                    { name: NON_RELATION_FIELD, type: 'string' },
                    {
                        name: LIST_RELATION_FIELD,
                        type: 'relation',
                        list: false,
                        entity: Asset,
                        cascade: ['remove'],
                        eager: false,
                    },
                ],
            }),
        );

        expect(mockLoggerWarn).toHaveBeenCalledWith(
            [
                `WARNING: You have set "cascade: ['remove' | 'soft-remove']" on a custom field relation to the "Asset" entity.`,
                `With this behavior, deleting a "Asset" row can delete owning rows that reference it.`,
                `Please verify this is intended, especially when targeting core Vendure entities.`,
            ].join('\n'),
        );
    });

    it('warns if cascade: ["soft-remove"] is affecting core Vendure entities', () => {
        registerCustomEntityFields(
            createConfig({
                Product: [
                    { name: NON_RELATION_FIELD, type: 'string' },
                    {
                        name: LIST_RELATION_FIELD,
                        type: 'relation',
                        list: false,
                        entity: Asset,
                        cascade: ['soft-remove'],
                        eager: false,
                    },
                ],
            }),
        );

        expect(mockLoggerWarn).toHaveBeenCalledWith(
            [
                `WARNING: You have set "cascade: ['remove' | 'soft-remove']" on a custom field relation to the "Asset" entity.`,
                `With this behavior, deleting a "Asset" row can delete owning rows that reference it.`,
                `Please verify this is intended, especially when targeting core Vendure entities.`,
            ].join('\n'),
        );
    });

    it('warns if cascade: true is affecting core Vendure entities', () => {
        registerCustomEntityFields(
            createConfig({
                Product: [
                    { name: NON_RELATION_FIELD, type: 'string' },
                    {
                        name: LIST_RELATION_FIELD,
                        type: 'relation',
                        list: false,
                        entity: Asset,
                        cascade: true,
                        eager: false,
                    },
                ],
            }),
        );

        expect(mockLoggerWarn).toHaveBeenCalledWith(
            [
                `WARNING: You have set "cascade: ['remove' | 'soft-remove']" on a custom field relation to the "Asset" entity.`,
                `With this behavior, deleting a "Asset" row can delete owning rows that reference it.`,
                `Please verify this is intended, especially when targeting core Vendure entities.`,
            ].join('\n'),
        );
    });

    it('should not warn if cascading is not affecting core entities', () => {
        registerCustomEntityFields(
            createConfig({
                Product: [
                    { name: NON_RELATION_FIELD, type: 'string' },
                    {
                        name: LIST_RELATION_FIELD,
                        type: 'relation',
                        list: false,
                        entity: TestEntity,
                        cascade: true,
                        onDelete: 'CASCADE',
                        eager: false,
                    },
                ],
            }),
        );

        expect(mockLoggerWarn).toBeCalledTimes(0);
    });

    it('should not warn if cascading is affecting join tables', () => {
        registerCustomEntityFields(
            createConfig({
                Product: [
                    { name: NON_RELATION_FIELD, type: 'string' },
                    {
                        name: LIST_RELATION_FIELD,
                        type: 'relation',
                        list: true,
                        entity: Asset,
                        cascade: true,
                        onDelete: 'CASCADE',
                        eager: false,
                    },
                ],
            }),
        );

        expect(mockLoggerWarn).toBeCalledTimes(0);
    });

    it('should ignore nullable on list relation fields', () => {
        registerCustomEntityFields(
            createConfig({
                Product: [
                    // @ts-expect-error -- nullable is not a valid option for many-to-many relations
                    {
                        name: LIST_RELATION_FIELD,
                        type: 'relation',
                        list: true,
                        entity: Asset,
                        nullable: true,
                    },
                ],
            }),
        );

        const relation = getMetadataArgsStorage()
            .filterRelations(getProductCustomFieldsClass())
            .find(r => r.propertyName === LIST_RELATION_FIELD);

        expect(relation?.relationType).toBe('many-to-many');
        expect(relation?.options.nullable).toBeUndefined();
    });
});

function createConfig(customFields: CustomFields): VendureConfig {
    return {
        customFields,
        dbConnectionOptions: {
            type: 'sqlite',
        },
    } as VendureConfig;
}

function getProductCustomFieldsClass() {
    const customFieldsEmbedded = getMetadataArgsStorage().embeddeds.find(item => {
        if (item.propertyName !== 'customFields') {
            return false;
        }
        const targetName = typeof item.target === 'string' ? item.target : item.target.name;
        return targetName === 'Product';
    });
    if (!customFieldsEmbedded) {
        throw new Error('Could not find Product customFields embedded metadata');
    }
    const customFieldsClass = customFieldsEmbedded.type();
    if (typeof customFieldsClass === 'string') {
        throw new Error('Expected Product customFields embedded type to be a class');
    }
    return customFieldsClass;
}

/**
 * Removes the metadata added by the tests in this file, to prevent pollution of other tests which use the same entity.
 */
function removeTestMetadata() {
    const metadata = getMetadataArgsStorage();
    const fieldNames = [SINGLE_RELATION_FIELD, LIST_RELATION_FIELD, NON_RELATION_FIELD];

    // @ts-ignore - accessing protected properties for test cleanup
    metadata.relations = metadata.relations.filter(r => !fieldNames.includes(r.propertyName));
    // @ts-ignore - accessing protected properties for test cleanup
    metadata.columns = metadata.columns.filter(c => !fieldNames.includes(c.propertyName));
    // @ts-ignore - accessing protected properties for test cleanup
    metadata.joinTables = metadata.joinTables.filter(jt => !fieldNames.includes(jt.propertyName));
    // @ts-ignore - accessing protected properties for test cleanup
    metadata.joinColumns = metadata.joinColumns.filter(jc => !fieldNames.includes(jc.propertyName));
}
