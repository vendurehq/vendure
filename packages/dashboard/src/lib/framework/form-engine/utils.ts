import {
    AllCustomFieldConfigs,
    BooleanCustomFieldConfig,
    BooleanStructField,
    ConfigurableArgDef,
    ConfigurableFieldDef,
    DateTimeCustomFieldConfig,
    DateTimeStructField,
    FloatCustomFieldConfig,
    FloatStructField,
    IntCustomFieldConfig,
    IntStructField,
    LocaleStringCustomFieldConfig,
    LocaleTextCustomFieldConfig,
    RelationCustomFieldConfig,
    StringCustomFieldConfig,
    StringStructField,
    StructCustomFieldConfig,
    StructField,
    TextCustomFieldConfig,
} from '@/vdb/framework/form-engine/form-engine-types.js';
import { FormEvent } from 'react';
import { UseFormReturn } from 'react-hook-form';

import { FieldInfo } from '../document-introspection/get-document-structure.js';

/**
 * Transforms relation fields in an entity, extracting IDs from relation objects.
 * This is primarily used for custom fields of type "ID".
 *
 * Walks the `fields` tree recursively so that `customFields` are processed
 * regardless of nesting depth (e.g. both `{ customFields }` and
 * `{ input: { customFields } }` are handled correctly).
 *
 * @param fields - Array of field information describing the expected structure
 * @param entity - The entity to transform
 * @returns A new entity with transformed relation fields
 */
export function transformRelationFields<E extends Record<string, any>>(fields: FieldInfo[], entity: E): E {
    // Create a shallow copy to avoid mutating the original entity
    const processedEntity = { ...entity };

    for (const field of fields) {
        if (field.name === 'customFields' && field.typeInfo) {
            // Found customFields at this level — process relation ID fields
            const sourceCustomFields = entity[field.name];
            if (!sourceCustomFields) {
                continue;
            }

            const customFieldsCopy = { ...sourceCustomFields };
            const idTypeCustomFields = field.typeInfo.filter(f => f.type === 'ID');

            for (const customField of idTypeCustomFields) {
                const relationField = customField.name;

                if (customField.list) {
                    // For list fields, the accessor is the field name without the "Ids" suffix
                    const propertyAccessorKey = customField.name.replace(/Ids$/, '');
                    const relationValue = sourceCustomFields[propertyAccessorKey];

                    if (relationValue === null) {
                        customFieldsCopy[relationField] = null;
                    } else if (Array.isArray(relationValue)) {
                        customFieldsCopy[relationField] = relationValue.map((v: { id: string }) => v.id);
                    }
                    delete customFieldsCopy[propertyAccessorKey];
                } else {
                    // For single fields, the accessor is the field name without the "Id" suffix
                    const propertyAccessorKey = customField.name.replace(/Id$/, '');
                    const relationValue = sourceCustomFields[propertyAccessorKey];
                    customFieldsCopy[relationField] = relationValue === null ? null : relationValue?.id;
                    delete customFieldsCopy[propertyAccessorKey];
                }
            }
            processedEntity[field.name as keyof E] = customFieldsCopy;
        } else if (field.typeInfo && !field.isScalar && entity[field.name] != null) {
            // Non-scalar nested field (e.g. `input`) — recurse into it
            const { typeInfo } = field;
            if (Array.isArray(entity[field.name])) {
                processedEntity[field.name as keyof E] = entity[field.name].map((item: any) =>
                    transformRelationFields(typeInfo, item),
                );
            } else if (typeof entity[field.name] === 'object') {
                processedEntity[field.name as keyof E] = transformRelationFields(
                    typeInfo,
                    entity[field.name],
                );
            }
        }
    }

    return processedEntity;
}

/**
 * @description
 * Due to the schema types, sometimes "create" mutations will have a default empty "id"
 * field which can cause issues if we actually send them with a "create" mutation to the server.
 * This function deletes any empty ID fields on the entity or its nested objects.
 */
export function removeEmptyIdFields<T extends Record<string, any>>(values: T, fields: FieldInfo[]): T {
    if (!values) {
        return values;
    }

    // Create a deep copy to avoid mutating the original values
    const result = structuredClone(values);

    function recursiveRemove(obj: any, fieldDefs: FieldInfo[]) {
        if (Array.isArray(obj)) {
            for (const item of obj) {
                recursiveRemove(item, fieldDefs);
            }
        } else if (typeof obj === 'object' && obj !== null) {
            for (const field of fieldDefs) {
                // Remove empty string ID fields at this level
                if (field.type === 'ID' && typeof obj[field.name] === 'string' && obj[field.name] === '') {
                    delete obj[field.name];
                }
                // If the field is an object or array, recurse into it
                if (Array.isArray(obj[field.name])) {
                    if (field.typeInfo) {
                        for (const item of obj[field.name]) {
                            recursiveRemove(item, field.typeInfo);
                        }
                    }
                } else if (
                    typeof obj[field.name] === 'object' &&
                    obj[field.name] !== null &&
                    field.typeInfo
                ) {
                    recursiveRemove(obj[field.name], field.typeInfo);
                }
            }
        }
    }

    recursiveRemove(result, fields);
    return result;
}

/**
 * Converts empty string values to null for nullable non-string fields before submission.
 * This handles cases where user interaction (e.g. clearing a date picker) leaves
 * empty strings that are invalid for non-string GraphQL types like DateTime or Enums.
 */
export function convertEmptyStringsToNull<T extends Record<string, any>>(values: T, fields: FieldInfo[]): T {
    if (!values) {
        return values;
    }
    const result = structuredClone(values);

    function processFields(obj: any, fieldDefs: FieldInfo[]) {
        for (const field of fieldDefs) {
            if (field.nullable && obj[field.name] === '' && field.type !== 'String') {
                obj[field.name] = null;
            }
            if (field.typeInfo && typeof obj[field.name] === 'object' && obj[field.name] !== null) {
                if (Array.isArray(obj[field.name])) {
                    for (const item of obj[field.name]) {
                        processFields(item, field.typeInfo);
                    }
                } else {
                    processFields(obj[field.name], field.typeInfo);
                }
            }
        }
    }

    processFields(result, fields);
    return result;
}

/**
 * Strips null-valued nullable fields from the payload so they are omitted
 * rather than sent as explicit nulls. In GraphQL, omitting a field lets the
 * server apply its own default, whereas sending null means "set to NULL".
 * This is only used for create mutations, to avoid sending explicit nulls for
 * fields the user likely did not touch.
 */
export function stripNullNullableFields<T extends Record<string, any>>(values: T, fields: FieldInfo[]): T {
    if (!values) return values;
    const result = structuredClone(values);

    function processFields(obj: any, fieldDefs: FieldInfo[]) {
        for (const field of fieldDefs) {
            if (field.nullable && obj[field.name] === null) {
                delete obj[field.name];
            } else if (field.typeInfo && typeof obj[field.name] === 'object' && obj[field.name] !== null) {
                if (Array.isArray(obj[field.name])) {
                    for (const item of obj[field.name]) {
                        processFields(item, field.typeInfo);
                    }
                } else {
                    processFields(obj[field.name], field.typeInfo);
                }
            }
        }
    }

    processFields(result, fields);
    return result;
}

/**
 * @description
 * Removes translation rows the form seeded but the user never edited. The form engine seeds a
 * translation row for every configured language (so any language can be edited in the form), but
 * submitting the untouched ones persists empty translation rows. Those empty rows break language
 * fallback — a lookup for that language finds the empty row instead of falling back to the default
 * language — most visibly in the search index, which shows an empty name. See #4885 / OSS-579.
 *
 * A row is kept when it is **dirty OR persisted**, and dropped otherwise. The two predicates are
 * complementary, each covering what the other is blind to:
 *
 * - `dirty` (from react-hook-form's `dirtyFields`) carries the **create** path: no row has an `id`
 *   yet, so a seeded row never typed into is not dirty and is dropped, while a filled one is kept.
 * - `persisted` (the row carries an `id`) carries the **update** path: react-hook-form's `values`
 *   prop resets the form and promotes the entity to `defaultValues`, so on an update nothing is
 *   dirty until the user types — an untouched persisted row and an untouched seeded row look
 *   identical to dirty state, and only the `id` separates them.
 *
 * Crucially there is no value inspection anywhere, so an untouched row seeded with a filled-looking
 * default (`Boolean` → `false`, `Int`/`Money` → `0`, enum → first member) is still correctly
 * dropped — a value-based "is it empty?" check would treat those as user input. Works at any
 * nesting depth and for any translatable sub-entity (detected by a `languageCode` field).
 *
 * NOTE: `dirtyFields` must be read during render for react-hook-form to populate it (its
 * `formState` is a lazily-tracked Proxy). Destructure it in the component/hook body, not only
 * inside the submit handler — otherwise it comes back empty and, combined with the floor below,
 * this silently keeps every row.
 */
export function stripUntouchedTranslations<T extends Record<string, any>>(
    values: T,
    fields: FieldInfo[],
    dirtyFields: any,
): T {
    if (!values) {
        return values;
    }
    const result = structuredClone(values);

    function process(obj: any, dirty: any, fieldDefs: FieldInfo[]) {
        for (const field of fieldDefs) {
            const value = obj?.[field.name];
            if (!value || typeof value !== 'object' || !field.typeInfo) {
                continue;
            }
            const dirtyValue = dirty?.[field.name];
            if (Array.isArray(value)) {
                const isTranslationsArray = field.typeInfo.some(f => f.name === 'languageCode');
                if (isTranslationsArray) {
                    const kept = value.filter((entry, i) => isDirty(dirtyValue?.[i]) || isPersisted(entry));
                    // Never strip every row: a fully-empty form (a non-nullable `String` maps to a
                    // bare `z.string()`, so a blank create passes validation) would otherwise submit
                    // `translations: []`. Leave the input untouched and let validation surface the
                    // empty required fields instead.
                    obj[field.name] = kept.length ? kept : value;
                }
                for (const [i, item] of obj[field.name].entries()) {
                    process(item, dirtyValue?.[i], field.typeInfo);
                }
            } else {
                process(value, dirtyValue, field.typeInfo);
            }
        }
    }

    process(result, dirtyFields, fields);
    return result;
}

function isDirty(value: any): boolean {
    if (value != null && typeof value === 'object') {
        return Object.values(value).some(isDirty);
    }
    return value === true;
}

/**
 * A row that already exists in the database carries an `id`. Dirty state alone cannot identify
 * these: react-hook-form's `values` prop resets the form and promotes the entity to
 * `defaultValues`, so on an update nothing is dirty until the user types — an untouched persisted
 * row and an untouched seeded row look identical. The `id` is the only thing that separates them.
 */
function isPersisted(entry: any): boolean {
    return !!entry && typeof entry === 'object' && entry.id != null && entry.id !== '';
}

// =============================================================================
// TYPE GUARDS FOR CONFIGURABLE FIELD DEFINITIONS
// =============================================================================

/**
 * Determines if a field definition is a custom field config (vs configurable operation arg)
 */
export function isCustomFieldConfig(input: ConfigurableFieldDef): input is AllCustomFieldConfigs {
    return input.hasOwnProperty('readonly');
}

/**
 * Determines if a field definition is a configurable operation argument
 */
export function isConfigurableArgDef(input: ConfigurableFieldDef): input is ConfigurableArgDef {
    return !input.hasOwnProperty('readonly');
}

// =============================================================================
// TYPE GUARDS FOR SPECIFIC CUSTOM FIELD TYPES
// =============================================================================

/**
 * String custom field with optional pattern and options
 */
export function isStringCustomFieldConfig(input: ConfigurableFieldDef): input is StringCustomFieldConfig {
    return input.type === 'string' && isCustomFieldConfig(input);
}

/**
 * String custom field that has options (select dropdown)
 */
export function isStringFieldWithOptions(input: ConfigurableFieldDef): input is StringCustomFieldConfig {
    const isCustomFieldWithOptions =
        input.type === 'string' &&
        isCustomFieldConfig(input) &&
        input.hasOwnProperty('options') &&
        Array.isArray((input as any).options);
    if (isCustomFieldWithOptions) {
        return true;
    }
    const isConfigArgWithOptions =
        input.type === 'string' && isConfigurableArgDef(input) && Array.isArray(input.ui?.options);
    if (isConfigArgWithOptions) {
        return true;
    }
    return false;
}

/**
 * Locale string custom field
 */
export function isLocaleStringCustomFieldConfig(
    input: ConfigurableFieldDef,
): input is LocaleStringCustomFieldConfig {
    return input.type === 'localeString' && isCustomFieldConfig(input);
}

/**
 * Text custom field (textarea)
 */
export function isTextCustomFieldConfig(input: ConfigurableFieldDef): input is TextCustomFieldConfig {
    return input.type === 'text' && isCustomFieldConfig(input);
}

/**
 * Locale text custom field (localized textarea)
 */
export function isLocaleTextCustomFieldConfig(
    input: ConfigurableFieldDef,
): input is LocaleTextCustomFieldConfig {
    return input.type === 'localeText' && isCustomFieldConfig(input);
}

/**
 * Boolean custom field
 */
export function isBooleanCustomFieldConfig(input: ConfigurableFieldDef): input is BooleanCustomFieldConfig {
    return input.type === 'boolean' && isCustomFieldConfig(input);
}

/**
 * Integer custom field with optional min/max/step
 */
export function isIntCustomFieldConfig(input: ConfigurableFieldDef): input is IntCustomFieldConfig {
    return input.type === 'int' && isCustomFieldConfig(input);
}

/**
 * Float custom field with optional min/max/step
 */
export function isFloatCustomFieldConfig(input: ConfigurableFieldDef): input is FloatCustomFieldConfig {
    return input.type === 'float' && isCustomFieldConfig(input);
}

/**
 * DateTime custom field with optional min/max/step
 */
export function isDateTimeCustomFieldConfig(input: ConfigurableFieldDef): input is DateTimeCustomFieldConfig {
    return input.type === 'datetime' && isCustomFieldConfig(input);
}

/**
 * Relation custom field (references another entity)
 */
export function isRelationCustomFieldConfig(input: ConfigurableFieldDef): input is RelationCustomFieldConfig {
    return input.type === 'relation' && isCustomFieldConfig(input);
}

/**
 * Struct custom field (nested object with sub-fields)
 */
export function isStructCustomFieldConfig(input: ConfigurableFieldDef): input is StructCustomFieldConfig {
    return input.type === 'struct' && isCustomFieldConfig(input);
}

// Legacy alias for backward compatibility
export const isStructFieldConfig = isStructCustomFieldConfig;

// =============================================================================
// TYPE GUARDS FOR STRUCT FIELD TYPES (fields within struct custom fields)
// =============================================================================

/**
 * String field within a struct custom field
 */
export function isStringStructField(input: StructField): input is StringStructField {
    return input.type === 'string';
}

/**
 * String struct field that has options (select dropdown).
 * Checks for options defined either directly or via ui.options.
 */
export function isStringStructFieldWithOptions(
    input: StructField,
): input is StringStructField & { options: any[] } {
    if (input.type !== 'string') {
        return false;
    }
    // Check for direct options property
    if (input.hasOwnProperty('options') && Array.isArray((input as any).options)) {
        return true;
    }
    // Also check for ui.options (fallback pattern)
    if (Array.isArray((input as any).ui?.options)) {
        return true;
    }
    return false;
}

/**
 * Extracts options from a field definition, normalizing the different locations
 * where options can be defined (direct property or ui.options).
 * Works for both ConfigurableFieldDef and StructField types.
 */
export function extractFieldOptions(
    field: ConfigurableFieldDef | StructField,
): NonNullable<StringCustomFieldConfig['options']> {
    // Check direct options property first
    if ((field as any).options && Array.isArray((field as any).options)) {
        return (field as any).options;
    }
    // Fall back to ui.options
    if (field.ui?.options && Array.isArray(field.ui.options)) {
        return field.ui.options;
    }
    return [];
}

/**
 * Integer field within a struct custom field
 */
export function isIntStructField(input: StructField): input is IntStructField {
    return input.type === 'int';
}

/**
 * Float field within a struct custom field
 */
export function isFloatStructField(input: StructField): input is FloatStructField {
    return input.type === 'float';
}

/**
 * Boolean field within a struct custom field
 */
export function isBooleanStructField(input: StructField): input is BooleanStructField {
    return input.type === 'boolean';
}

/**
 * DateTime field within a struct custom field
 */
export function isDateTimeStructField(input: StructField): input is DateTimeStructField {
    return input.type === 'datetime';
}

// =============================================================================
// UTILITY TYPE GUARDS
// =============================================================================

/**
 * Determines if a field is a list/array field
 */
export function isListField(input?: ConfigurableFieldDef): boolean {
    return input && isCustomFieldConfig(input) ? Boolean(input.list) : false;
}

/**
 * Determines if a field is readonly
 */
export function isReadonlyField(input?: ConfigurableFieldDef): boolean {
    return input && isCustomFieldConfig(input) ? Boolean(input.readonly) : false;
}

/**
 * Determines if a field should be disabled based on the `disabled` prop from
 * react-hook-form's Controller and the field's own readonly configuration.
 *
 * This centralises the disabled check so that every input component handles
 * both sources of disabled state consistently.
 */
export function isFieldDisabled(disabled?: boolean, fieldDef?: ConfigurableFieldDef): boolean {
    return Boolean(disabled) || isReadonlyField(fieldDef);
}

/**
 * Determines if a field requires special permissions
 */
export function hasPermissionRequirement(input: ConfigurableFieldDef): boolean {
    return isCustomFieldConfig(input) && Boolean(input.requiresPermission);
}

/**
 * Determines if a field is nullable
 */
export function isNullableField(input: ConfigurableFieldDef): boolean {
    return isCustomFieldConfig(input) && Boolean(input.nullable);
}

/**
 * Determines if a custom field or struct sub-field allows null values.
 * Configurable operation args are never treated as nullable.
 */
export function isFieldNullable(input: ConfigurableFieldDef | StructField): boolean {
    if (isCustomFieldConfig(input as ConfigurableFieldDef)) {
        return (input as ConfigurableFieldDef & { nullable?: boolean }).nullable !== false;
    }
    if ('nullable' in input && input.nullable) {
        return true;
    }
    return false;
}

/**
 * Handles nested form submission to prevent event bubbling in nested forms.
 * This is useful when you have a form inside a dialog that's within another form.
 *
 * @param form - The react-hook-form instance
 * @param onSubmit - The submit handler function
 * @returns An event handler that prevents propagation and handles the form submission
 *
 * @example
 * ```tsx
 * const form = useForm<FormSchema>({ resolver: zodResolver(formSchema) });
 *
 * return (
 *   <form onSubmit={handleNestedFormSubmit(form, (data) => {
 *     // Handle form submission
 *   })}>
 *     ...
 *   </form>
 * );
 * ```
 */
export function handleNestedFormSubmit<TFieldValues extends Record<string, any>>(
    form: UseFormReturn<TFieldValues>,
    onSubmit: (data: TFieldValues) => void | Promise<void>,
) {
    return (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        e.stopPropagation();
        void form.handleSubmit(onSubmit)(e);
    };
}
