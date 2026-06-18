import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { zodResolver } from '@/vdb/lib/zod.js';
import { VariablesOf } from 'gql.tada';
import { FormEvent, useEffect, useMemo, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { useChannel } from '../../hooks/use-channel.js';
import { useServerConfig } from '../../hooks/use-server-config.js';
import { getOperationVariablesFields } from '../document-introspection/get-document-structure.js';
import {
    applyNullableSelectCustomFieldDefaults,
    createFormSchemaFromFields,
    getDefaultValuesFromFields,
} from './form-schema-tools.js';
import {
    convertEmptyStringsToNull,
    removeEmptyIdFields,
    stripNullNullableFields,
    transformRelationFields,
} from './utils.js';

// Stable empty array reference used as a fallback when the server config
// (and therefore `availableLanguages`) has not yet loaded — keeps memo
// dependencies stable across renders.
const EMPTY_LANGUAGES: string[] = [];

export type WithLooseCustomFields<T> = T extends { customFields?: any }
    ? Omit<T, 'customFields'> & { customFields?: T['customFields'] | unknown }
    : T;

/**
 * @description
 * Options for the useGeneratedForm hook.
 *
 * @docsCategory detail-views
 * @docsPage useGeneratedForm
 * @since 3.3.0
 */
export interface GeneratedFormOptions<
    T extends TypedDocumentNode<any, any>,
    VarName extends keyof VariablesOf<T> | undefined = 'input',
    E extends Record<string, any> = Record<string, any>,
> {
    /**
     * @description
     * The document to use to generate the form.
     */
    document?: T;
    /**
     * @description
     * The name of the variable to use in the document.
     */
    varName?: VarName;
    /**
     * @description
     * The entity to use to generate the form.
     */
    entity: E | null | undefined;
    customFieldConfig?: any[]; // Add custom field config for validation
    setValues: (
        entity: NonNullable<E>,
    ) => WithLooseCustomFields<
        VarName extends keyof VariablesOf<T> ? VariablesOf<T>[VarName] : VariablesOf<T>
    >;
    onSubmit?: (
        values: VarName extends keyof VariablesOf<T> ? VariablesOf<T>[VarName] : VariablesOf<T>,
    ) => void;
}

/**
 * @description
 * This hook is used to create a form from a document and an entity.
 * It will create a form with the fields defined in the document's input type.
 * It will also create a submit handler that will submit the form to the server.
 *
 * This hook is mostly used internally by the higher-level {@link useDetailPage} hook,
 * but can in some cases be useful to use directly.
 *
 * @example
 * ```tsx
 * const { form, submitHandler } = useGeneratedForm({
 *  document: setDraftOrderCustomFieldsDocument,
 *  varName: undefined,
 *  entity: entity,
 *  setValues: entity => {
 *    return {
 *      orderId: entity.id,
 *      input: {
 *        customFields: entity.customFields,
 *      },
 *    };
 *  },
 * });
 * ```
 *
 * @docsCategory detail-views
 * @docsPage useGeneratedForm
 * @since 3.3.0
 * @docsWeight 0
 */
export function useGeneratedForm<
    T extends TypedDocumentNode<any, any>,
    VarName extends keyof VariablesOf<T> | undefined,
    E extends Record<string, any> = Record<string, any>,
>(options: GeneratedFormOptions<T, VarName, E>) {
    const { document, entity, setValues, onSubmit, varName, customFieldConfig } = options;
    const { activeChannel } = useChannel();
    const serverConfig = useServerConfig();

    // Callers typically pass `setValues` as an inline arrow function, which
    // would change identity every render. Hold it in a ref so the values
    // memo below can call the latest version without recomputing — and
    // without going stale on a closure.
    const setValuesRef = useRef(setValues);
    useEffect(() => {
        setValuesRef.current = setValues;
    }, [setValues]);

    // Recomputing this on every render produces a new array identity which
    // ripples into the schema and default-values memos below, defeating any
    // stable form state. Memoise on the document + varName.
    const updateFields = useMemo(
        () => (document ? getOperationVariablesFields(document, varName) : []),
        [document, varName],
    );

    // ServerConfigProvider memoises its value on the underlying query data,
    // so this array has stable identity across renders when the server
    // config hasn't changed.
    const availableLanguages = serverConfig?.availableLanguages ?? EMPTY_LANGUAGES;

    // Without memoisation these objects/arrays are rebuilt on every render of
    // the parent route. When the schema changes identity, react-hook-form's
    // resolver is replaced and the form re-validates everything; when
    // defaultValues changes identity it can also reset uncontrolled inputs.
    const schema = useMemo(
        () => createFormSchemaFromFields(updateFields, customFieldConfig),
        [updateFields, customFieldConfig],
    );
    const defaultValues = useMemo(
        () => getDefaultValuesFromFields(updateFields, activeChannel?.defaultLanguageCode, customFieldConfig),
        [updateFields, activeChannel?.defaultLanguageCode, customFieldConfig],
    );
    const processedEntity = useMemo(
        () => ensureTranslationsForAllLanguages(entity, availableLanguages, defaultValues),
        [entity, availableLanguages, defaultValues],
    );
    const processedDefaultValues = useMemo(
        () =>
            ensureTranslationsForAllLanguages(defaultValues, availableLanguages, defaultValues) ??
            defaultValues,
        [defaultValues, availableLanguages],
    );

    const values = useMemo(() => {
        const raw = processedEntity
            ? transformRelationFields(updateFields, setValuesRef.current(processedEntity))
            : processedDefaultValues;
        return applyNullableSelectCustomFieldDefaults(raw, customFieldConfig);
    }, [processedEntity, processedDefaultValues, updateFields, customFieldConfig]);

    const form = useForm({
        resolver: async (values, context, options) => {
            const result = await zodResolver(schema)(values, context, options);
            if (Object.keys(result.errors).length > 0) {
                console.log('Zod form validation errors:', result.errors);
            }
            return result;
        },
        mode: 'onChange',
        defaultValues: processedDefaultValues,
        values,
    });
    let submitHandler = (event: FormEvent): any => {
        event.preventDefault();
    };
    if (onSubmit) {
        submitHandler = async (event: FormEvent) => {
            event.preventDefault();

            // Trigger validation on ALL fields, not just dirty ones
            const isValid = await form.trigger();

            if (!isValid) {
                console.log(`Form invalid!`);
                event.stopPropagation();
                return;
            }

            const onSubmitWrapper = (values: any) => {
                let processed = convertEmptyStringsToNull(
                    removeEmptyIdFields(values, updateFields),
                    updateFields,
                );
                if (!entity) {
                    processed = stripNullNullableFields(processed, updateFields);
                }
                onSubmit(processed);
            };
            form.handleSubmit(onSubmitWrapper)(event);
        };
    }

    return { form, submitHandler };
}

/**
 * Ensures that an entity with translations has entries for all available languages.
 * If a language is missing, it creates an empty translation based on the structure of existing translations
 * and the expected form structure from defaultValues.
 */
function ensureTranslationsForAllLanguages<E extends Record<string, any>>(
    entity: E | null | undefined,
    availableLanguages: string[] = [],
    expectedStructure?: Record<string, any>,
): E | null | undefined {
    if (
        !entity ||
        !('translations' in entity) ||
        !Array.isArray((entity as any).translations) ||
        !availableLanguages.length
    ) {
        return entity;
    }

    // Create a deep copy of the entity to avoid mutation
    const processedEntity = { ...entity } as any;
    const translations = [...(processedEntity.translations || [])];

    // Get existing language codes
    const existingLanguageCodes = new Set(translations.map((t: any) => t.languageCode));

    // Get the expected translation structure from defaultValues or existing translations
    const existingTemplate = translations[0] || {};
    const expectedTranslationStructure = expectedStructure?.translations?.[0] || {};

    // Merge the structures to ensure we have all expected fields
    const templateStructure = {
        ...expectedTranslationStructure,
        ...existingTemplate,
    };

    // Add missing language translations
    for (const langCode of availableLanguages) {
        if (!existingLanguageCodes.has(langCode)) {
            const emptyTranslation: Record<string, any> = {
                languageCode: langCode,
            };

            // Add empty fields based on merged template structure (excluding languageCode)
            Object.keys(templateStructure).forEach(key => {
                if (key !== 'languageCode') {
                    if (typeof templateStructure[key] === 'object' && templateStructure[key] !== null) {
                        // For nested objects like customFields, create an empty object
                        emptyTranslation[key] = Array.isArray(templateStructure[key]) ? [] : {};
                    } else {
                        // For primitive values, use empty string as default
                        emptyTranslation[key] = '';
                    }
                }
            });

            translations.push(emptyTranslation);
        } else {
            // For existing translations, ensure they have all expected fields
            const existingTranslation = translations.find((t: any) => t.languageCode === langCode);
            if (existingTranslation) {
                Object.keys(expectedTranslationStructure).forEach(key => {
                    if (key !== 'languageCode' && !(key in existingTranslation)) {
                        if (
                            typeof expectedTranslationStructure[key] === 'object' &&
                            expectedTranslationStructure[key] !== null
                        ) {
                            existingTranslation[key] = Array.isArray(expectedTranslationStructure[key])
                                ? []
                                : {};
                        } else {
                            existingTranslation[key] = '';
                        }
                    }
                });
            }
        }
    }

    // Update the processed entity with complete translations
    processedEntity.translations = translations;

    return processedEntity as E;
}
