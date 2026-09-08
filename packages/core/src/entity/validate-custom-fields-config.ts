import { Type } from '@vendure/common/lib/shared-types';
import { getGraphQlInputName } from '@vendure/common/lib/shared-utils';
import { DataSourceOptions, getMetadataArgsStorage } from 'typeorm';

import { CustomFieldConfig, CustomFields } from '../config/custom-field/custom-field-types';

import { VendureEntity } from './base/base.entity';

function validateCustomFieldsForEntity(
    entity: Type<VendureEntity>,
    customFields: CustomFieldConfig[],
    dbEngine: DataSourceOptions['type'],
): string[] {
    return [
        ...assertValidFieldNames(entity.name, customFields),
        ...assertNoNameConflictsWithEntity(entity, customFields),
        ...assertNoDuplicatedCustomFieldNames(entity.name, customFields),
        ...assertNoRelationIdNameConflicts(entity.name, customFields),
        ...assetNonNullablesHaveDefaults(entity.name, customFields),
        ...assertValidIndexConfiguration(entity.name, customFields, dbEngine),
        ...(isTranslatable(entity) ? [] : assertNoLocaleStringFields(entity.name, customFields)),
    ];
}

/**
 * Assert that database indexes are only configured for column types supported by the
 * selected database engine. This runtime check also covers dynamically assembled or
 * widened custom-field configs which cannot be protected by TypeScript alone.
 */
function assertValidIndexConfiguration(
    entityName: string,
    customFields: CustomFieldConfig[],
    dbEngine: DataSourceOptions['type'],
): string[] {
    const errors: string[] = [];
    for (const field of customFields) {
        if (field.index === true) {
            if (field.secret === true) {
                errors.push(
                    `${entityName} entity custom field "${field.name}" cannot be indexed because secret fields are stored as encrypted unbounded text`,
                );
            }
            if (field.list === true) {
                errors.push(
                    `${entityName} entity custom field "${field.name}" cannot be indexed because list fields are stored as JSON`,
                );
            }
            if (field.type === 'struct') {
                errors.push(
                    `${entityName} entity custom field "${field.name}" cannot be indexed because struct fields are stored as JSON`,
                );
            }
        }
        if (
            (field.index === true || field.unique === true) &&
            field.secret !== true &&
            (field.type === 'text' || field.type === 'localeText') &&
            (dbEngine === 'mysql' || dbEngine === 'mariadb')
        ) {
            errors.push(
                `${entityName} entity custom field "${field.name}" cannot be indexed or unique on ${dbEngine} because ${field.type} fields are stored as longtext`,
            );
        }
    }
    return errors;
}

/**
 * Assert that the custom entity names are valid
 */
function assertValidFieldNames(entityName: string, customFields: CustomFieldConfig[]): string[] {
    const errors: string[] = [];
    const validNameRe = /^[a-zA-Z_]+[a-zA-Z0-9_]*$/;
    for (const field of customFields) {
        if (!validNameRe.test(field.name)) {
            errors.push(`${entityName} entity has an invalid custom field name: "${field.name}"`);
        }
    }
    return errors;
}

function assertNoNameConflictsWithEntity(entity: Type<any>, customFields: CustomFieldConfig[]): string[] {
    const errors: string[] = [];
    for (const field of customFields) {
        const conflicts = (e: Type<any>): boolean => {
            return -1 < getAllColumnNames(e).findIndex(name => name === field.name);
        };
        const translation = getEntityTranslation(entity);
        if (conflicts(entity) || (translation && conflicts(translation))) {
            errors.push(`${entity.name} entity already has a field named "${field.name}"`);
        }
    }
    return errors;
}

/**
 * Assert that none of the custom field names conflict with one another.
 */
function assertNoDuplicatedCustomFieldNames(entityName: string, customFields: CustomFieldConfig[]): string[] {
    const nameCounts = customFields
        .map(f => f.name)
        .reduce(
            (hash, name) => {
                if (hash[name]) {
                    hash[name]++;
                } else {
                    hash[name] = 1;
                }
                return hash;
            },
            {} as { [name: string]: number },
        );
    return Object.entries(nameCounts)
        .filter(([name, count]) => 1 < count)
        .map(([name, count]) => `${entityName} entity has duplicated custom field name: "${name}"`);
}

/**
 * Relation custom fields are represented by an id property (`ownerId`/`ownerIds`) in GraphQL
 * input types and, for non-list relations, as an id column on the entity. Assert that no other
 * custom field is named in a way that would collide with those properties.
 */
function assertNoRelationIdNameConflicts(entityName: string, customFields: CustomFieldConfig[]): string[] {
    const errors: string[] = [];
    for (const field of customFields) {
        if (field.type === 'relation') {
            const idPropertyName = getGraphQlInputName(field);
            if (customFields.some(f => f !== field && f.name === idPropertyName)) {
                errors.push(
                    `${entityName} entity has a custom field "${idPropertyName}" which conflicts with the ` +
                        `id property of the relation custom field "${field.name}"`,
                );
            }
        }
    }
    return errors;
}

/**
 * For entities which are not localized (Address, Customer), we assert that none of the custom fields
 * have a type "localeString".
 */
function assertNoLocaleStringFields(entityName: string, customFields: CustomFieldConfig[]): string[] {
    if (!!customFields.find(f => f.type === 'localeString')) {
        return [`${entityName} entity does not support custom fields of type "localeString"`];
    }
    return [];
}

/**
 * Assert that any non-nullable field must have a defaultValue specified.
 */
function assetNonNullablesHaveDefaults(entityName: string, customFields: CustomFieldConfig[]): string[] {
    const errors: string[] = [];
    for (const field of customFields) {
        if (field.nullable === false && field.defaultValue === undefined) {
            errors.push(
                `${entityName} entity custom field "${field.name}" is non-nullable and must have a defaultValue`,
            );
        }
    }
    return errors;
}

function isTranslatable(entity: Type<any>): boolean {
    return !!getEntityTranslation(entity);
}

function getEntityTranslation(entity: Type<any>): Type<any> | undefined {
    const metadata = getMetadataArgsStorage();
    const translation = metadata.filterRelations(entity).find(r => r.propertyName === 'translations');
    if (translation) {
        const type = translation.type;
        if (typeof type === 'function') {
            // See https://github.com/microsoft/TypeScript/issues/37663
            return (type as any)();
        }
    }
}

function getAllColumnNames(entity: Type<any>): string[] {
    const metadata = getMetadataArgsStorage();
    const ownColumns = metadata.filterColumns(entity);
    const relationColumns = metadata.filterRelations(entity);
    const embeddedColumns = metadata.filterEmbeddeds(entity);
    const baseColumns = metadata.filterColumns(VendureEntity);
    return [...ownColumns, ...relationColumns, ...embeddedColumns, ...baseColumns].map(c => c.propertyName);
}

/**
 * Validates the custom fields config, e.g. by ensuring that there are no naming conflicts with the built-in fields
 * of each entity.
 */
export function validateCustomFieldsConfig(
    customFieldConfig: CustomFields,
    entities: Array<Type<any>>,
    dbEngine: DataSourceOptions['type'] = 'sqlite',
): { valid: boolean; errors: string[] } {
    let errors: string[] = [];
    getMetadataArgsStorage();
    for (const key of Object.keys(customFieldConfig)) {
        const entityName = key as keyof CustomFields;
        const customEntityFields = customFieldConfig[entityName] || [];
        const entity = entities.find(e => e.name === entityName);
        if (entity && customEntityFields.length) {
            errors = errors.concat(validateCustomFieldsForEntity(entity, customEntityFields, dbEngine));
        }
    }
    return {
        valid: errors.length === 0,
        errors,
    };
}
