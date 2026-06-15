import {
    FieldInfo,
    isEnumType,
    isScalarType,
} from '@/vdb/framework/document-introspection/get-document-structure.js';
import {
    ConfigurableFieldDef,
    CustomFieldConfig,
    DateTimeCustomFieldConfig,
    FloatCustomFieldConfig,
    IntCustomFieldConfig,
    StringCustomFieldConfig,
    StructCustomFieldConfig,
    StructField,
} from '@/vdb/framework/form-engine/form-engine-types.js';
import { isStringFieldWithOptions, isStructCustomFieldConfig } from '@/vdb/framework/form-engine/utils.js';
import { z, ZodRawShape, ZodType, ZodTypeAny } from '@/vdb/lib/zod.js';

function mapGraphQLCustomFieldToConfig(field: StructField) {
    const { __typename, ...rest } = field;
    const baseConfig: CustomFieldConfig = {
        ...rest,
        list: field.list ?? false,
        readonly: false,
        requiresPermission: [],
        nullable: true, // Default to true since GraphQL fields are nullable by default
    };

    switch (field.__typename) {
        case 'StringStructFieldConfig':
            return {
                ...baseConfig,
                __typename: 'StringCustomFieldConfig',
                pattern: field.pattern ?? null,
                options: [],
            } satisfies StringCustomFieldConfig;
        case 'IntStructFieldConfig':
            return {
                ...baseConfig,
                __typename: 'IntCustomFieldConfig',
                intMin: field.intMin ?? null,
                intMax: field.intMax ?? null,
                intStep: field.intStep ?? null,
            } satisfies IntCustomFieldConfig;
        case 'FloatStructFieldConfig':
            return {
                ...baseConfig,
                __typename: 'FloatCustomFieldConfig',
                floatMin: field.floatMin ?? null,
                floatMax: field.floatMax ?? null,
                floatStep: field.floatStep ?? null,
            } satisfies FloatCustomFieldConfig;
        case 'DateTimeStructFieldConfig':
            return {
                ...baseConfig,
                __typename: 'DateTimeCustomFieldConfig',
                datetimeMin: field.datetimeMin ?? null,
                datetimeMax: field.datetimeMax ?? null,
                datetimeStep: field.datetimeStep ?? null,
            } satisfies DateTimeCustomFieldConfig;
        default:
            return baseConfig;
    }
}

/**
 * Safely parses a date string into a Date object.
 * Used for parsing datetime constraints in custom field validation.
 *
 * @param dateStr - The date string to parse
 * @returns Parsed Date object or undefined if invalid
 */
function parseDate(dateStr: string | undefined | null): Date | undefined {
    if (!dateStr) return undefined;
    const date = new Date(dateStr);
    return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Creates a Zod validation schema for datetime fields with optional min/max constraints.
 * Supports both string and Date inputs, which is common in form handling.
 *
 * @param minDate - Optional minimum date constraint
 * @param maxDate - Optional maximum date constraint
 * @returns Zod schema that validates date ranges
 */
function createDateValidationSchema(minDate: Date | undefined, maxDate: Date | undefined): ZodType {
    const baseSchema = z.union([z.string(), z.date()]);
    if (!minDate && !maxDate) return baseSchema;

    const dateMinString = minDate?.toLocaleDateString() ?? '';
    const dateMaxString = maxDate?.toLocaleDateString() ?? '';
    const dateMinMessage = minDate ? `Date must be after ${dateMinString}` : '';
    const dateMaxMessage = maxDate ? `Date must be before ${dateMaxString}` : '';

    return baseSchema.refine(
        val => {
            if (!val) return true;
            const date = val instanceof Date ? val : new Date(val);
            if (minDate && date < minDate) return false;
            if (maxDate && date > maxDate) return false;
            return true;
        },
        val => {
            const date = val instanceof Date ? val : new Date(val);
            if (minDate && date < minDate) return { message: dateMinMessage };
            if (maxDate && date > maxDate) return { message: dateMaxMessage };
            return { message: '' };
        },
    );
}

/**
 * Creates a Zod validation schema for string fields with optional regex pattern validation.
 * Used for string-type custom fields that may have pattern constraints.
 *
 * @param pattern - Optional regex pattern string for validation
 * @returns Zod string schema with optional pattern validation
 */
function createStringValidationSchema(pattern?: string | null): ZodType {
    let schema = z.string();
    if (pattern) {
        schema = schema.regex(new RegExp(pattern), {
            message: `Value must match pattern: ${pattern}`,
        });
    }
    return schema;
}

/**
 * Creates a Zod validation schema for integer fields with optional min/max constraints.
 * Used for int-type custom fields that may have numeric range limits.
 *
 * @param min - Optional minimum value constraint
 * @param max - Optional maximum value constraint
 * @returns Zod number schema with optional range validation
 */
function createNumberValidationSchema(min?: number | null, max?: number | null): ZodType {
    let schema = z.number();
    if (min != null) {
        schema = schema.min(min, {
            message: `Value must be at least ${min}`,
        });
    }
    if (max != null) {
        schema = schema.max(max, {
            message: `Value must be at most ${max}`,
        });
    }
    return schema;
}

/**
 * Creates a Zod validation schema for a single custom field based on its type and constraints.
 * This is the main dispatcher that routes different custom field types to their specific
 * validation schema creators. Handles all standard custom field types in Vendure.
 *
 * @param customField - The custom field configuration object
 * @returns Zod schema appropriate for the custom field type
 */
function createCustomFieldValidationSchema(customField: CustomFieldConfig): ZodType {
    let zodType: ZodType;

    switch (customField.type) {
        case 'localeString':
        case 'localeText':
        case 'string':
            zodType = createStringValidationSchema((customField as StringCustomFieldConfig).pattern);
            break;
        case 'int':
            zodType = createNumberValidationSchema(
                (customField as IntCustomFieldConfig).intMin,
                (customField as IntCustomFieldConfig).intMax,
            );
            break;
        case 'float':
            zodType = createNumberValidationSchema(
                (customField as FloatCustomFieldConfig).floatMin,
                (customField as FloatCustomFieldConfig).floatMax,
            );
            break;
        case 'datetime': {
            const minDate = parseDate((customField as DateTimeCustomFieldConfig).datetimeMin);
            const maxDate = parseDate((customField as DateTimeCustomFieldConfig).datetimeMax);
            zodType = createDateValidationSchema(minDate, maxDate);
            break;
        }
        case 'boolean':
            zodType = z.boolean();
            break;
        default:
            zodType = z.any();
            break;
    }

    return zodType;
}

/**
 * Creates a Zod validation schema for struct-type custom fields.
 * Struct fields contain nested sub-fields, each with their own validation rules.
 * This recursively processes each sub-field to create a nested object schema.
 *
 * @param structFieldConfig - The struct custom field configuration with nested fields
 * @returns Zod object schema representing the struct with all sub-field validations
 */
function createStructFieldSchema(structFieldConfig: StructCustomFieldConfig): ZodType {
    if (!structFieldConfig.fields || !Array.isArray(structFieldConfig.fields)) {
        return z.object({}).passthrough();
    }

    const nestedSchema: ZodRawShape = {};
    for (const structSubField of structFieldConfig.fields) {
        const config = mapGraphQLCustomFieldToConfig(structSubField);
        let subFieldType = createCustomFieldValidationSchema(config);

        // Handle list and nullable for struct sub-fields
        if (config.list) {
            subFieldType = z.array(subFieldType);
        }
        if (config.nullable) {
            subFieldType = subFieldType.optional().nullable();
        }

        nestedSchema[config.name] = subFieldType;
    }

    return z.object(nestedSchema);
}

/**
 * Applies common list and nullable modifiers to a Zod schema based on custom field configuration.
 * Many custom fields can be configured as lists (arrays) and/or nullable, so this helper
 * centralizes that logic to avoid duplication.
 *
 * @param zodType - The base Zod schema to modify
 * @param customField - Custom field config containing list/nullable flags
 * @returns Modified Zod schema with list/nullable modifiers applied
 */
function applyCustomFieldModifiers(zodType: ZodType, customField: CustomFieldConfig): ZodType {
    let modifiedType = zodType;

    if (customField.list) {
        modifiedType = z.array(modifiedType);
    }
    if (customField.nullable !== false) {
        modifiedType = modifiedType.optional().nullable();
    }
    if (customField.readonly) {
        modifiedType = modifiedType.readonly();
    }
    return modifiedType;
}

/**
 * Processes all custom fields and creates a complete validation schema for the customFields object.
 * Handles context-aware filtering (translation vs root context) and orchestrates the creation
 * of validation schemas for all custom field types including complex struct fields.
 *
 * @param customFieldConfigs - Array of all custom field configurations
 * @param isTranslationContext - Whether we're processing fields for translation forms
 * @returns Zod schema shape for the entire customFields object
 */
function processCustomFieldsSchema(
    customFieldConfigs: CustomFieldConfig[],
    isTranslationContext: boolean,
): ZodRawShape {
    const customFieldsSchema: ZodRawShape = {};
    const translatableTypes = ['localeString', 'localeText'];

    const filteredCustomFields = customFieldConfigs.filter(cf => {
        if (isTranslationContext) {
            return translatableTypes.includes(cf.type);
        } else {
            return !translatableTypes.includes(cf.type);
        }
    });

    for (const customField of filteredCustomFields) {
        let zodType: ZodType;

        if (customField.type === 'struct') {
            zodType = createStructFieldSchema(customField as StructCustomFieldConfig);
        } else {
            zodType = createCustomFieldValidationSchema(customField);
        }

        zodType = applyCustomFieldModifiers(zodType, customField);
        const schemaPropertyName = getGraphQlInputName(customField);
        customFieldsSchema[schemaPropertyName] = zodType;
    }

    return customFieldsSchema;
}

export function createFormSchemaFromFields(
    fields: FieldInfo[],
    customFieldConfigs?: CustomFieldConfig[],
    isTranslationContext = false,
) {
    const schemaConfig: ZodRawShape = {};

    for (const field of fields) {
        const isScalar = isScalarType(field.type);
        const isEnum = isEnumType(field.type);

        if ((isScalar || isEnum) && field.name !== 'customFields') {
            schemaConfig[field.name] = getZodTypeFromField(field);
        } else if (field.name === 'customFields') {
            const customFieldsSchema =
                customFieldConfigs && customFieldConfigs.length > 0
                    ? processCustomFieldsSchema(customFieldConfigs, isTranslationContext)
                    : {};
            // Use .passthrough() to preserve custom field values that aren't in the schema
            // This is essential for nested entities (e.g., ProductVariantPrice) whose custom
            // field configs aren't passed to the parent form schema builder
            schemaConfig[field.name] = z.object(customFieldsSchema).passthrough().optional();
        } else if (field.typeInfo) {
            const isNestedTranslationContext = field.name === 'translations' || isTranslationContext;
            let nestedType: ZodType = createFormSchemaFromFields(
                field.typeInfo,
                customFieldConfigs,
                isNestedTranslationContext,
            );

            if (field.nullable) {
                nestedType = nestedType.optional().nullable();
            }
            if (field.list) {
                nestedType = z.array(nestedType);
            }

            schemaConfig[field.name] = nestedType;
        }
    }

    return z.object(schemaConfig);
}

export function getDefaultValuesFromFields(
    fields: FieldInfo[],
    defaultLanguageCode?: string,
    customFieldConfigs?: CustomFieldConfig[],
) {
    const defaultValues: Record<string, any> = {};
    for (const field of fields) {
        if (field.typeInfo) {
            const nestedObjectDefaults = getDefaultValuesFromFields(field.typeInfo, defaultLanguageCode);
            if (field.list) {
                defaultValues[field.name] = [nestedObjectDefaults];
            } else {
                defaultValues[field.name] = nestedObjectDefaults;
            }
        } else {
            defaultValues[field.name] = getDefaultValueFromField(field, defaultLanguageCode);
        }
    }
    return applyNullableSelectCustomFieldDefaults(defaultValues, customFieldConfigs);
}

/**
 * Nullable string fields with options should default to `null`, not `''`.
 */
export function applyNullableSelectCustomFieldDefaults<T extends Record<string, any>>(
    values: T,
    customFieldConfigs?: CustomFieldConfig[],
): T {
    if (!customFieldConfigs?.length || values.customFields == null) return values;

    return {
        ...values,
        customFields: applyNullableSelectDefaultsToCustomFieldsObject(
            values.customFields,
            customFieldConfigs,
        ),
    };
}

function applyNullableSelectDefaultsToCustomFieldsObject(
    customFieldsDefaults: Record<string, any>,
    configs: CustomFieldConfig[],
): Record<string, any> {
    const result = { ...customFieldsDefaults };
    for (const config of configs) {
        const fieldDef = config as ConfigurableFieldDef;
        if (isStructCustomFieldConfig(fieldDef)) {
            const structValue = result[fieldDef.name];
            if (structValue && typeof structValue === 'object' && !Array.isArray(structValue)) {
                result[fieldDef.name] = applyNullableSelectDefaultsToStructFields(
                    structValue,
                    fieldDef.fields,
                );
            }
        } else if (
            config.type === 'string' &&
            isStringFieldWithOptions(config as ConfigurableFieldDef) &&
            config.nullable !== false &&
            (result[config.name] === '' || result[config.name] === undefined)
        ) {
            result[config.name] = null;
        }
    }
    return result;
}

function applyNullableSelectDefaultsToStructFields(
    structDefaults: Record<string, any>,
    fields: StructField[],
): Record<string, any> {
    const result = { ...structDefaults };
    for (const field of fields) {
        const subFieldConfig = mapGraphQLCustomFieldToConfig(field);
        if (
            subFieldConfig.type === 'string' &&
            isStringFieldWithOptions(subFieldConfig as ConfigurableFieldDef) &&
            subFieldConfig.nullable !== false &&
            (result[field.name] === '' || result[field.name] === undefined)
        ) {
            result[field.name] = null;
        }
    }
    return result;
}

export function getDefaultValueFromField(field: FieldInfo, defaultLanguageCode?: string) {
    if (field.list) {
        return [];
    }
    if (field.nullable) {
        switch (field.type) {
            case 'String':
                return '';
            case 'ID':
                return '';
            case 'LanguageCode':
                return defaultLanguageCode || 'en';
            case 'Boolean':
                return false;
            default:
                // Object-typed fields (e.g. customFields without typeInfo) should default
                // to {} to match the Zod schema which expects an object.
                // JSON scalar is used for customFields when the field structure isn't
                // known from introspection — it still represents an object at runtime.
                if (!field.isScalar || field.type === 'JSON') {
                    return {};
                }
                return null;
        }
    }
    switch (field.type) {
        case 'String':
        case 'DateTime':
            return '';
        case 'Int':
        case 'Float':
        case 'Money':
            return 0;
        case 'Boolean':
            return false;
        case 'ID':
            return '';
        case 'LanguageCode':
            return defaultLanguageCode || 'en';
        case 'JSON':
            return {};
        default:
            return '';
    }
}

export function getZodTypeFromField(field: FieldInfo): ZodTypeAny {
    let zodType: ZodType;

    // This function is only used for non-custom fields, so we don't need custom field logic here
    // Custom fields are handled separately in createFormSchemaFromFields

    switch (field.type) {
        case 'String':
        case 'ID':
        case 'DateTime':
            zodType = z.string();
            break;
        case 'Int':
        case 'Float':
        case 'Money':
            zodType = z.number();
            break;
        case 'Boolean':
            zodType = z.boolean();
            break;
        default:
            zodType = z.any();
    }

    if (field.list) {
        zodType = z.array(zodType);
    }
    if (field.nullable) {
        zodType = zodType.optional().nullable();
    }
    return zodType;
}

export function getGraphQlInputName(config: { name: string; type: string; list?: boolean }): string {
    if (config.type === 'relation') {
        return config.list === true ? `${config.name}Ids` : `${config.name}Id`;
    } else {
        return config.name;
    }
}
