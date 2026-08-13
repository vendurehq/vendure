/* eslint-disable @typescript-eslint/ban-types */
import { CustomFieldType, Type } from '@vendure/common/lib/shared-types';
import { assertNever } from '@vendure/common/lib/shared-utils';
import {
    Column,
    ColumnOptions,
    ColumnType,
    getMetadataArgsStorage,
    Index,
    JoinColumn,
    JoinTable,
    ManyToMany,
    ManyToOne,
} from 'typeorm';
import { EmbeddedMetadataArgs } from 'typeorm/metadata-args/EmbeddedMetadataArgs';
import { RelationMetadataArgs } from 'typeorm/metadata-args/RelationMetadataArgs';
import { DateUtils } from 'typeorm/util/DateUtils';

import { CustomFieldConfig, CustomFields } from '../config/custom-field/custom-field-types';
import { Logger } from '../config/logger/vendure-logger';
import { VendureConfig } from '../config/vendure-config';
import { getDatabaseType, VendureDatabaseType } from '../connection/database-type';

import { EntityId } from './entity-id.decorator';
import { EncryptedFieldTransformer } from './value-transformers';

/**
 * The maximum length of the "length" argument of a MySQL varchar column.
 */
const MAX_STRING_LENGTH = 65535;

/**
 * @description
 * Returns the names of all registered entities that support custom fields (i.e.
 * implement `HasCustomFields`). An entity supports custom fields when it declares
 * a `customFields` embedded property, so we detect them from the TypeORM metadata
 * rather than a runtime-unavailable `implements` check. Used to auto-initialise
 * `config.customFields[EntityName]` so plugins can extend any such entity without
 * a defensive guard (OSS-408).
 *
 * Translation entities are excluded: they carry their own `customFields` embedded
 * (to hold localized field values) but are never valid `config.customFields` keys —
 * localized custom fields are declared on the *base* entity. Auto-initialising an
 * entry for a translation entity would make the GraphQL schema builder emit a
 * duplicate `customFields` field on the `*TranslationInput` types (colliding with
 * the one derived from the base entity's localized fields — "Field
 * `CreateXTranslationInput.customFields` can only be defined once"). We detect
 * translation entities as the target of a `translations` relation, the same signal
 * `registerCustomEntityFields` uses to locate the translation type.
 */
export function getEntityNamesWithCustomFields(entities: Array<Type<any>>): string[] {
    // Scope to the entities actually registered with this server. The global metadata storage
    // holds every entity imported anywhere in the process — including ones not registered here
    // (a second server in the same process, or an imported-but-uninstalled plugin) — which would
    // otherwise seed phantom `config.customFields` keys.
    const registeredEntityNames = new Set(entities.map(entity => entity.name));
    const metadataArgsStorage = getMetadataArgsStorage();
    // The translation-entity exclusion set is intentionally built from the process-global metadata:
    // it is only ever used to exclude, and the candidate names are already filtered to
    // `registeredEntityNames` below, so a superset here is harmless.
    const translationEntityNames = new Set(
        metadataArgsStorage.relations
            .filter(relation => relation.propertyName === 'translations')
            .map(relation => getRelationTargetName(relation.type))
            .filter((name): name is string => name != null),
    );
    const names = metadataArgsStorage.embeddeds
        .filter(embedded => embedded.propertyName === 'customFields')
        .map(embedded => (typeof embedded.target === 'string' ? embedded.target : embedded.target.name))
        .filter(name => registeredEntityNames.has(name))
        .filter(name => !translationEntityNames.has(name));
    return Array.from(new Set(names));
}

/**
 * Resolves a TypeORM relation target to the target entity's name. The target may be a
 * constructor closure (`() => ProductTranslation`, the usual form), a bare string name, or a
 * closure returning a string — the latter two are both legal and commonly used to break
 * circular imports (`@OneToMany('ArticleTranslation', ...)`). Calling a non-function, as the
 * previous code did unconditionally, threw `relation.type is not a function` and aborted
 * bootstrap; a closure returning a string yielded `undefined` and silently failed to exclude
 * the translation entity.
 */
function getRelationTargetName(type: RelationMetadataArgs['type']): string | undefined {
    const resolved: unknown = typeof type === 'function' ? (type as () => unknown)() : type;
    if (typeof resolved === 'string') {
        return resolved;
    }
    if (typeof resolved === 'function') {
        return resolved.name;
    }
    // Anything else that carries a `name` (e.g. an EntitySchema-like object).
    return (resolved as { name?: string } | undefined)?.name;
}

/**
 * Dynamically add columns to the custom field entity based on the CustomFields config.
 */
function registerCustomFieldsForEntity(
    config: VendureConfig,
    entityName: keyof CustomFields,
    // eslint-disable-next-line @typescript-eslint/prefer-function-type
    ctor: { new (): any },
    translation = false,
) {
    const customFields = config.customFields && config.customFields[entityName];
    const dbEngine = getDatabaseType(config.dbConnectionOptions);
    if (customFields) {
        for (const customField of customFields) {
            const { name, list, defaultValue, nullable } = customField;
            if (customField.secret === true) {
                // Validate secret-field constraints that apply regardless of the underlying storage,
                // before branching on the field type. Otherwise an unsupported type such as
                // `relation` is silently registered without encryption or redaction.
                if (customField.type !== 'string' && customField.type !== 'text') {
                    throw new Error(
                        `ERROR: The custom field "${customField.name}" has "secret: true", which ` +
                            'is only supported on "string" and "text" fields.',
                    );
                }
                if (list) {
                    throw new Error(
                        `ERROR: The custom field "${customField.name}" cannot combine "secret: true" ` +
                            'with "list: true".',
                    );
                }
                if (defaultValue !== undefined) {
                    throw new Error(
                        `ERROR: The custom field "${customField.name}" cannot combine "secret: true" ` +
                            'with a "defaultValue", because a column default would be stored unencrypted.',
                    );
                }
            }
            const instance = new ctor();
            const registerColumn = () => {
                if (customField.type === 'relation') {
                    if (customField.list) {
                        ManyToMany(type => customField.entity, customField.inverseSide, {
                            eager: customField.eager,
                        })(instance, name);
                        JoinTable()(instance, name);
                    } else {
                        ManyToOne(type => customField.entity, customField.inverseSide, {
                            eager: customField.eager,
                        })(instance, name);
                        JoinColumn()(instance, name);
                        // Expose the foreign key as an id property (e.g. "ownerId"), which maps
                        // to the same database column as the relation's join column.
                        EntityId({ nullable: true })(instance, `${name}Id`);
                    }
                } else {
                    const options: ColumnOptions = {
                        type: getColumnType(dbEngine, customField.type, list ?? false),
                        default: getDefault(customField, dbEngine),
                        name,
                        nullable: nullable === false ? false : true,
                        unique: customField.unique ?? false,
                    };
                    if ((customField.type === 'string' || customField.type === 'localeString') && !list) {
                        const length = customField.length || 255;
                        if (MAX_STRING_LENGTH < length) {
                            throw new Error(
                                `ERROR: The "length" property of the custom field "${customField.name}" is ` +
                                    `greater than the maximum allowed value of ${MAX_STRING_LENGTH}`,
                            );
                        }
                        options.length = length;
                    }
                    if (
                        customField.type === 'float' &&
                        typeof customField.defaultValue === 'number' &&
                        (dbEngine === 'mariadb' || dbEngine === 'mysql')
                    ) {
                        // In the MySQL driver, a default float value will get rounded to the nearest integer.
                        // unless you specify the precision.
                        const defaultValueDecimalPlaces = customField.defaultValue.toString().split('.')[1];
                        if (defaultValueDecimalPlaces) {
                            options.scale = defaultValueDecimalPlaces.length;
                        }
                    }
                    if (
                        customField.type === 'datetime' &&
                        options.precision == null &&
                        // Setting precision on an sqlite datetime will cause
                        // spurious migration commands. See https://github.com/typeorm/typeorm/issues/2333
                        dbEngine !== 'sqljs' &&
                        dbEngine !== 'sqlite' &&
                        !list
                    ) {
                        options.precision = 6;
                    }
                    if (customField.secret === true) {
                        if (customField.unique === true) {
                            throw new Error(
                                `ERROR: The custom field "${customField.name}" cannot combine "secret: true" ` +
                                    'with "unique: true", because encrypted values cannot be uniquely indexed.',
                            );
                        }
                        if (customField.type === 'string' && customField.length != null) {
                            throw new Error(
                                `ERROR: The custom field "${customField.name}" cannot combine "secret: true" ` +
                                    'with an explicit "length", because encrypted values are stored as unbounded text.',
                            );
                        }
                        // Ciphertext is longer than the plaintext and variable in size, so it is
                        // stored as unbounded text and encrypted/decrypted via the configured strategy.
                        options.type = getColumnType(dbEngine, 'text', false);
                        delete options.length;
                        delete options.default;
                        options.transformer = new EncryptedFieldTransformer(
                            () => config.systemOptions?.encryptionStrategy,
                        );
                    }
                    Column(options)(instance, name);
                    if ((dbEngine === 'mysql' || dbEngine === 'mariadb') && customField.unique === true) {
                        // The MySQL driver seems to work differently and will only apply a unique
                        // constraint if an index is defined on the column. For postgres/sqlite it is
                        // sufficient to add the `unique: true` property to the column options.
                        Index({ unique: true })(instance, name);
                    }
                }
            };

            if (translation) {
                if (customField.type === 'localeString' || customField.type === 'localeText') {
                    registerColumn();
                }
            } else {
                if (customField.type !== 'localeString' && customField.type !== 'localeText') {
                    registerColumn();
                }
            }

            const relationFieldsCount = customFields.filter(f => f.type === 'relation').length;
            const nonLocaleStringFieldsCount = customFields.filter(
                f => f.type !== 'localeString' && f.type !== 'localeText' && f.type !== 'relation',
            ).length;

            if (0 < relationFieldsCount && nonLocaleStringFieldsCount === 0) {
                // if (customFields.filter(f => f.type === 'relation').length === customFields.length) {
                // If there are _only_ relational customFields defined for an Entity, then TypeORM
                // errors when attempting to load that entity ("Cannot set property <fieldName> of undefined").
                // Therefore as a work-around we will add a "fake" column to the customFields embedded type
                // to prevent this error from occurring.
                Column({
                    type: 'boolean',
                    nullable: true,
                    comment:
                        'A work-around needed when only relational custom fields are defined on an entity',
                })(instance, '__fix_relational_custom_fields__');
            }
        }
    }
}

function formatDefaultDatetime(dbEngine: VendureDatabaseType, datetime: any): Date | string {
    if (!datetime) {
        return datetime;
    }
    switch (dbEngine) {
        case 'sqlite':
        case 'sqljs':
            return DateUtils.mixedDateToUtcDatetimeString(datetime);
        case 'mysql':
        case 'postgres':
        default:
            return DateUtils.mixedDateToUtcDatetimeString(datetime);
        // return DateUtils.mixedDateToDate(datetime, true, true);
    }
}

function getColumnType(
    dbEngine: VendureDatabaseType,
    type: Exclude<CustomFieldType, 'relation'>,
    isList: boolean,
): ColumnType {
    if (isList && type !== 'struct') {
        return 'simple-json';
    }
    switch (type) {
        case 'string':
        case 'localeString':
            return 'varchar';
        case 'text':
        case 'localeText':
            switch (dbEngine) {
                case 'mysql':
                case 'mariadb':
                    return 'longtext';
                default:
                    return 'text';
            }
        case 'boolean':
            switch (dbEngine) {
                case 'mysql':
                    return 'tinyint';
                case 'postgres':
                    return 'bool';
                case 'sqlite':
                case 'sqljs':
                default:
                    return 'boolean';
            }
        case 'int':
            return 'int';
        case 'float':
            return 'double precision';
        case 'datetime':
            switch (dbEngine) {
                case 'postgres':
                    return 'timestamp';
                case 'mysql':
                case 'sqlite':
                case 'sqljs':
                default:
                    return 'datetime';
            }
        case 'struct':
            switch (dbEngine) {
                case 'postgres':
                    return 'jsonb';
                case 'mysql':
                case 'mariadb':
                    return 'json';
                case 'sqlite':
                case 'sqljs':
                default:
                    return 'simple-json';
            }
        default:
            assertNever(type);
    }
    return 'varchar';
}

function getDefault(customField: CustomFieldConfig, dbEngine: VendureDatabaseType) {
    const { name, type, list, defaultValue, nullable } = customField;
    if (list && defaultValue) {
        if (dbEngine === 'mysql') {
            // MySQL does not support defaults on TEXT fields, which is what "simple-json" uses
            // internally. See https://stackoverflow.com/q/3466872/772859
            Logger.warn(
                `MySQL does not support default values on list fields (${name}). No default will be set.`,
            );
            return undefined;
        }
        return JSON.stringify(defaultValue);
    }
    return type === 'datetime' ? formatDefaultDatetime(dbEngine, defaultValue) : defaultValue;
}

function assertLocaleFieldsNotSpecified(config: VendureConfig, entityName: keyof CustomFields) {
    const customFields = config.customFields && config.customFields[entityName];
    if (customFields) {
        for (const customField of customFields) {
            if (customField.type === 'localeString' || customField.type === 'localeText') {
                Logger.error(
                    `Custom field "${customField.name}" on entity "${entityName}" cannot be of type "localeString" or "localeText". ` +
                        `This entity does not support localization.`,
                );
            }
        }
    }
}

/**
 * Dynamically registers any custom fields with TypeORM. This function should be run at the bootstrap
 * stage of the app lifecycle, before the AppModule is initialized.
 */
export function registerCustomEntityFields(config: VendureConfig) {
    // In order to determine the classes used for the custom field embedded types, we need
    // to introspect the metadata args storage.
    const metadataArgsStorage = getMetadataArgsStorage();

    for (const [entityName, customFieldsConfig] of Object.entries(config.customFields ?? {})) {
        if (customFieldsConfig && customFieldsConfig.length) {
            const customFieldsMetadata = getCustomFieldsMetadata(entityName);
            const customFieldsClass = customFieldsMetadata.type();
            if (customFieldsClass && typeof customFieldsClass !== 'string') {
                registerCustomFieldsForEntity(config, entityName, customFieldsClass as any);
            }
            const translationsMetadata = metadataArgsStorage
                .filterRelations(customFieldsMetadata.target)
                .find(m => m.propertyName === 'translations');
            if (translationsMetadata) {
                // This entity is translatable, which means that we should
                // also register any localized custom fields on the related
                // EntityTranslation entity. Resolve the target via the shared
                // helper so a bare-string or closure-returning-string relation
                // target (both legal, used to break circular imports) does not
                // throw `type is not a function` here — the same crash fixed in
                // getEntityNamesWithCustomFields().
                const translationEntityName = getRelationTargetName(translationsMetadata.type);
                if (translationEntityName != null) {
                    const customFieldsTranslationsMetadata = getCustomFieldsMetadata(translationEntityName);
                    const customFieldsTranslationClass = customFieldsTranslationsMetadata.type();
                    if (customFieldsTranslationClass && typeof customFieldsTranslationClass !== 'string') {
                        registerCustomFieldsForEntity(
                            config,
                            entityName,
                            customFieldsTranslationClass as any,
                            true,
                        );
                    }
                }
            } else {
                assertLocaleFieldsNotSpecified(config, entityName);
            }
        }
    }

    function getCustomFieldsMetadata(entity: Function | string): EmbeddedMetadataArgs {
        const entityName = typeof entity === 'string' ? entity : entity.name;
        const metadataArgs = metadataArgsStorage.embeddeds.find(item => {
            if (item.propertyName === 'customFields') {
                const targetName = typeof item.target === 'string' ? item.target : item.target.name;
                return targetName === entityName;
            }
        });

        if (!metadataArgs) {
            throw new Error(`Could not find embedded CustomFields property on entity "${entityName}"`);
        }
        return metadataArgs;
    }
}
