import { zodResolver, type ZodObject, type ZodTypeAny } from '@/vdb/lib/zod.js';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
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
    stripUntouchedTranslations,
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
    /**
     * @description
     * Refines the auto-generated Zod schema before it is passed to the form resolver. Use this
     * to declare the fields which must actually be filled in by the user.
     *
     * The generated schema is derived from the GraphQL input type, which only expresses
     * nullability — and nullability tells you nothing about whether a value is required:
     *
     * - A non-nullable field may still be legitimately empty. `String!` means "not null", not
     *   "not empty", and a non-nullable `ID!` such as `CreateFacetValueInput.facetId` may be
     *   supplied by the page in `transformCreateInput` rather than by the user.
     * - A nullable field may still be required by the server. `CreateChannelInput.
     *   defaultCurrencyCode` is nullable, yet `ChannelService.create` rejects the input unless
     *   it is set.
     *
     * Note that this is read once, when the schema is first built: it is held in a ref so that
     * an inline arrow function does not replace the resolver on every render.
     *
     * @example
     * ```ts
     * extendSchema: schema =>
     *     schema.extend({
     *         code: z.string().min(1, { message: t`This field is required` }),
     *     }),
     * ```
     *
     * @since 3.7.0
     */
    extendSchema?: (schema: ZodObject<any>) => ZodTypeAny;
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
    const { document, entity, setValues, onSubmit, varName, customFieldConfig, extendSchema } = options;
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

    // Same reasoning as `setValues`: an inline `extendSchema` arrow would change
    // identity every render, replacing the resolver and re-validating the whole
    // form each time. Read it from a ref so the schema memo below stays stable.
    const extendSchemaRef = useRef(extendSchema);
    useEffect(() => {
        extendSchemaRef.current = extendSchema;
    }, [extendSchema]);

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
    const schema = useMemo(() => {
        const generated = createFormSchemaFromFields(updateFields, customFieldConfig);
        return extendSchemaRef.current?.(generated) ?? generated;
    }, [updateFields, customFieldConfig]);
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
    // Read `dirtyFields` here, during render, so react-hook-form's lazily-tracked `formState`
    // Proxy actually populates it. If it were only read inside the submit handler it could come
    // back empty, and `stripUntouchedTranslations` would then keep every seeded row (see its docs).
    const { dirtyFields } = form.formState;

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
                // Drop translation rows the form seeded for languages the user never filled,
                // so we don't persist empty translations that break language fallback (#4885).
                processed = stripUntouchedTranslations(processed, updateFields, dirtyFields);
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
