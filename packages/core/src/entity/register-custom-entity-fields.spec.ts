import { DeepPartial } from '@vendure/common/lib/shared-types';
import { getMetadataArgsStorage } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Logger } from '../config';
import { CustomFieldConfig, CustomFields } from '../config/custom-field/custom-field-types';
import { VendureConfig } from '../config/vendure-config';

import { Asset } from './asset/asset.entity';
import { VendureEntity } from './base/base.entity';
import { registerCustomEntityFields, registerCustomFieldsForEntity } from './register-custom-entity-fields';

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

    it('applies cascade/onDelete/onUpdate/eager on many-to-one relation custom fields', () => {
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

    it("warns if onDelete: 'CASCADE' is affecting core Vendure entities", () => {
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
                `WARNING: You have set "onDelete: 'CASCADE'" on the custom field relation "Product.${LIST_RELATION_FIELD}" to the "Asset" entity.`,
                `Deleting "Asset" rows will also delete the "Product" rows that reference them.`,
                `"Asset" is a core Vendure entity, so make sure this is what you intend.`,
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
                `WARNING: You have set "cascade: ["remove"]" on the custom field relation "Product.${LIST_RELATION_FIELD}" to the "Asset" entity.`,
                `Removing "Product" rows with TypeORM's remove() or softRemove() will also remove the "Asset" rows they reference.`,
                `"Asset" is a core Vendure entity, so make sure this is what you intend.`,
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
                `WARNING: You have set "cascade: ["soft-remove"]" on the custom field relation "Product.${LIST_RELATION_FIELD}" to the "Asset" entity.`,
                `Removing "Product" rows with TypeORM's remove() or softRemove() will also remove the "Asset" rows they reference.`,
                `"Asset" is a core Vendure entity, so make sure this is what you intend.`,
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
                `WARNING: You have set "cascade: true (which includes 'remove' and 'soft-remove')" on the custom field relation "Product.${LIST_RELATION_FIELD}" to the "Asset" entity.`,
                `Removing "Product" rows with TypeORM's remove() or softRemove() will also remove the "Asset" rows they reference.`,
                `"Asset" is a core Vendure entity, so make sure this is what you intend.`,
            ].join('\n'),
        );
    });

    it('warns if a mixed cascade array including "remove" affects core Vendure entities', () => {
        registerCustomEntityFields(
            createConfig({
                Product: [
                    { name: NON_RELATION_FIELD, type: 'string' },
                    {
                        name: SINGLE_RELATION_FIELD,
                        type: 'relation',
                        list: false,
                        entity: Asset,
                        cascade: ['insert', 'remove'],
                        eager: false,
                    },
                ],
            }),
        );

        expect(mockLoggerWarn).toHaveBeenCalledWith(
            [
                `WARNING: You have set "cascade: ["insert","remove"]" on the custom field relation "Product.${SINGLE_RELATION_FIELD}" to the "Asset" entity.`,
                `Removing "Product" rows with TypeORM's remove() or softRemove() will also remove the "Asset" rows they reference.`,
                `"Asset" is a core Vendure entity, so make sure this is what you intend.`,
            ].join('\n'),
        );
    });

    it('should not warn for cascade: ["insert"] on a core entity', () => {
        registerCustomEntityFields(
            createConfig({
                Product: [
                    { name: NON_RELATION_FIELD, type: 'string' },
                    {
                        name: SINGLE_RELATION_FIELD,
                        type: 'relation',
                        list: false,
                        entity: Asset,
                        cascade: ['insert', 'update'],
                        eager: false,
                    },
                ],
            }),
        );

        expect(mockLoggerWarn).toBeCalledTimes(0);
    });

    it('should not warn for onDelete: "SET NULL" on a core entity', () => {
        registerCustomEntityFields(
            createConfig({
                Product: [
                    { name: NON_RELATION_FIELD, type: 'string' },
                    {
                        name: SINGLE_RELATION_FIELD,
                        type: 'relation',
                        list: false,
                        entity: Asset,
                        onDelete: 'SET NULL',
                        eager: false,
                    },
                ],
            }),
        );

        expect(mockLoggerWarn).toBeCalledTimes(0);
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

class IndexedCustomFields {}
class RelatedEntity {}

describe('registerCustomFieldsForEntity() indexes', () => {
    const metadata = getMetadataArgsStorage();
    let originalLengths: {
        columns: number;
        indices: number;
        relations: number;
        joinColumns: number;
    };

    beforeEach(() => {
        originalLengths = {
            columns: metadata.columns.length,
            indices: metadata.indices.length,
            relations: metadata.relations.length,
            joinColumns: metadata.joinColumns.length,
        };
    });

    afterEach(() => {
        metadata.columns.splice(originalLengths.columns);
        metadata.indices.splice(originalLengths.indices);
        metadata.relations.splice(originalLengths.relations);
        metadata.joinColumns.splice(originalLengths.joinColumns);
    });

    it.each(['mysql', 'mariadb', 'postgres', 'sqlite'] as const)(
        'registers one non-unique scalar index for %s',
        dbEngine => {
            register(dbEngine, [{ name: 'reference', type: 'string', index: true }]);
            register(dbEngine, [{ name: 'reference', type: 'string', index: true }]);

            const indices = getTestIndices('reference');
            expect(indices).toHaveLength(1);
            expect(indices[0].unique).not.toBe(true);
        },
    );

    it.each(['mysql', 'mariadb', 'postgres', 'sqlite'] as const)(
        'does not duplicate a unique index for %s',
        dbEngine => {
            register(dbEngine, [{ name: 'reference', type: 'string', unique: true, index: true }]);
            register(dbEngine, [{ name: 'reference', type: 'string', unique: true, index: true }]);

            const indices = getTestIndices('reference');
            if (dbEngine === 'mysql' || dbEngine === 'mariadb') {
                expect(indices).toHaveLength(1);
                expect(indices[0].unique).toBe(true);
            } else {
                expect(indices).toHaveLength(0);
            }
        },
    );

    it.each(['mysql', 'mariadb', 'postgres', 'sqlite'] as const)(
        'registers the index on a single relation property for %s',
        dbEngine => {
            const fields: CustomFieldConfig[] = [
                {
                    name: 'related',
                    type: 'relation',
                    entity: RelatedEntity,
                    index: true,
                },
            ];
            register(dbEngine, fields);
            register(dbEngine, fields);

            const indices = getTestIndices('related');
            expect(indices).toHaveLength(1);
            expect(indices[0].unique).not.toBe(true);
        },
    );

    function register(
        dbEngine: VendureConfig['dbConnectionOptions']['type'],
        fields: CustomFieldConfig[],
    ): void {
        const config = {
            customFields: { Product: fields },
            dbConnectionOptions: { type: dbEngine },
        } as VendureConfig;
        registerCustomFieldsForEntity(config, 'Product', IndexedCustomFields);
    }

    function getTestIndices(propertyName: string) {
        return metadata.indices.filter(
            index =>
                index.target === IndexedCustomFields &&
                Array.isArray(index.columns) &&
                index.columns.includes(propertyName),
        );
    }
});
