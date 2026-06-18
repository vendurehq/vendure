import { removeReadonlyAndLocalizedCustomFields } from '@/vdb/lib/utils.js';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import {
    DefinedInitialDataOptions,
    queryOptions,
    useMutation,
    useQueryClient,
    useSuspenseQuery,
} from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { ResultOf, VariablesOf } from 'gql.tada';
import { DocumentNode } from 'graphql';
import { FormEvent } from 'react';
import { UseFormReturn } from 'react-hook-form';

import { NEW_ENTITY_PATH } from '../../constants.js';
import { api } from '../../graphql/api.js';
import { useCustomFieldConfig } from '../../hooks/use-custom-field-config.js';
import { useExtendedDetailQuery } from '../../hooks/use-extended-detail-query.js';
import { addCustomFields } from '../document-introspection/add-custom-fields.js';
import {
    getEntityName,
    getMutationName,
    getQueryName,
} from '../document-introspection/get-document-structure.js';
import { useGeneratedForm, WithLooseCustomFields } from '../form-engine/use-generated-form.js';

import { DetailEntityPath } from './page-types.js';

// Utility type to remove null from a type union
type RemoveNull<T> = T extends null ? never : T;

type RemoveNullFields<T> = {
    [K in keyof T]: RemoveNull<T[K]>;
};

const NEW_ENTITY_ID = '__NEW__';

/**
 * @description
 * Options used to configure the result of the `useDetailPage` hook.
 *
 * @docsCategory detail-views
 * @docsPage useDetailPage
 * @since 3.3.0
 */
export interface DetailPageOptions<
    T extends TypedDocumentNode<any, any>,
    C extends TypedDocumentNode<any, any>,
    U extends TypedDocumentNode<any, any>,
    EntityField extends keyof ResultOf<T> = DetailEntityPath<T>,
    VarNameCreate extends keyof VariablesOf<C> = 'input',
    VarNameUpdate extends keyof VariablesOf<U> = 'input',
> {
    /**
     * @description
     * The page id. This is optional, but if provided, it will be used to
     * identify the page when extending the detail page query
     */
    pageId?: string;
    /**
     * @description
     * The query document to fetch the entity.
     */
    queryDocument: T;
    /**
     * @description
     * The field of the query document that contains the entity.
     */
    entityField?: EntityField;
    /**
     * @description
     * The parameters used to identify the entity.
     */
    params: {
        id: string;
    };
    /**
     * @description
     * The entity type name for custom field configuration lookup.
     * Required to filter out readonly custom fields before mutations.
     * If not provided, the function will try to infer it from the query document.
     */
    entityName?: string;
    /**
     * @description
     * The document to create the entity.
     */
    createDocument?: C;
    /**
     * @description
     * The document to update the entity.
     */
    updateDocument?: U;
    /**
     * @description
     * The function to set the values for the update document.
     */
    setValuesForUpdate: (
        entity: NonNullable<ResultOf<T>[EntityField]>,
    ) => WithLooseCustomFields<VariablesOf<U>[VarNameUpdate]>;
    transformCreateInput?: (input: VariablesOf<C>[VarNameCreate]) => VariablesOf<C>[VarNameCreate];
    transformUpdateInput?: (input: VariablesOf<U>[VarNameUpdate]) => VariablesOf<U>[VarNameUpdate];
    /**
     * @description
     * The function to call when the update is successful.
     */
    onSuccess?: (entity: ResultOf<C>[keyof ResultOf<C>] | ResultOf<U>[keyof ResultOf<U>]) => void;
    /**
     * @description
     * The function to call when the update is successful.
     */
    onError?: (error: unknown) => void;
}

export function getDetailQueryOptions<T, V extends { id: string }>(
    document: TypedDocumentNode<T, V> | DocumentNode,
    variables: V,
    options: Partial<Parameters<typeof queryOptions>[0]> = {},
): DefinedInitialDataOptions {
    const queryName = getQueryName(document);
    return queryOptions({
        queryKey: ['DetailPage', queryName, variables],
        queryFn: () => (variables.id === NEW_ENTITY_ID ? null : api.query(document, variables)),
        ...options,
    }) as DefinedInitialDataOptions;
}

/**
 * @description
 * Adds a "customFields" property to the translations if the entity has translations.
 */
export type DetailPageTranslations<
    T extends TypedDocumentNode<any, any>,
    EntityField extends keyof ResultOf<T>,
> = 'translations' extends keyof NonNullable<ResultOf<T>[EntityField]>
    ? Array<NonNullable<ResultOf<T>[EntityField]>['translations'][number] & { customFields?: any }>
    : undefined;

/**
 * @description
 * Adds a "customFields" property to the entity and a "translations" property to the entity.
 */
export type DetailPageEntity<
    T extends TypedDocumentNode<any, any>,
    EntityField extends keyof ResultOf<T>,
> = ResultOf<T>[EntityField] & {
    customFields?: any;
    translations: DetailPageTranslations<T, EntityField>;
};

/**
 * @description
 *
 * @docsCategory detail-views
 * @docsPage useDetailPage
 * @since 3.3.0
 */
export interface UseDetailPageResult<
    T extends TypedDocumentNode<any, any>,
    U extends TypedDocumentNode<any, any>,
    EntityField extends keyof ResultOf<T>,
> {
    form: UseFormReturn<RemoveNullFields<VariablesOf<U>['input']>>;
    submitHandler: (event: FormEvent<HTMLFormElement>) => void;
    entity?: DetailPageEntity<T, EntityField>;
    isPending: boolean;
    refreshEntity: () => void;
    resetForm: () => void;
}

/**
 * @description
 * **Status: Developer Preview**
 *
 * This hook is used to create an entity detail page which can read
 * and update an entity.
 *
 * @example
 * ```ts
 * const { form, submitHandler, entity, isPending, resetForm } = useDetailPage({
 *     queryDocument: paymentMethodDetailDocument,
 *     createDocument: createPaymentMethodDocument,
 *     updateDocument: updatePaymentMethodDocument,
 *     setValuesForUpdate: entity => {
 *         return {
 *             id: entity.id,
 *             enabled: entity.enabled,
 *             name: entity.name,
 *             code: entity.code,
 *             description: entity.description,
 *             checker: entity.checker?.code
 *                 ? {
 *                       code: entity.checker?.code,
 *                       arguments: entity.checker?.args,
 *                   }
 *                 : null,
 *             handler: entity.handler?.code
 *                 ? {
 *                       code: entity.handler?.code,
 *                       arguments: entity.handler?.args,
 *                   }
 *                 : null,
 *             translations: entity.translations.map(translation => ({
 *                 id: translation.id,
 *                 languageCode: translation.languageCode,
 *                 name: translation.name,
 *                 description: translation.description,
 *             })),
 *             customFields: entity.customFields,
 *         };
 *     },
 *     transformCreateInput: input => {
 *         return {
 *             ...input,
 *             checker: input.checker?.code ? input.checker : undefined,
 *             handler: input.handler,
 *         };
 *     },
 *     params: { id: params.id },
 *     onSuccess: async data => {
 *         toast.success(i18n.t('Successfully updated payment method'));
 *         resetForm();
 *         if (creatingNewEntity) {
 *             await navigate({ to: `../$id`, params: { id: data.id } });
 *         }
 *     },
 *     onError: err => {
 *         toast.error(i18n.t('Failed to update payment method'), {
 *             description: err instanceof Error ? err.message : 'Unknown error',
 *         });
 *     },
 * });
 * ```
 *
 * @docsCategory detail-views
 * @docsPage useDetailPage
 * @docsWeight 0
 * @since 3.3.0
 */
export function useDetailPage<
    T extends TypedDocumentNode<any, any>,
    C extends TypedDocumentNode<any, any>,
    U extends TypedDocumentNode<any, any>,
    EntityField extends keyof ResultOf<T> = keyof ResultOf<T>,
    VarNameUpdate extends keyof VariablesOf<U> = 'input',
    VarNameCreate extends keyof VariablesOf<C> = 'input',
>(
    options: DetailPageOptions<T, C, U, EntityField, VarNameCreate, VarNameUpdate>,
): UseDetailPageResult<T, U, EntityField> {
    const {
        pageId,
        queryDocument,
        createDocument,
        updateDocument,
        setValuesForUpdate,
        transformCreateInput,
        transformUpdateInput,
        params,
        entityField,
        entityName,
        onSuccess,
        onError,
    } = options;
    const isNew = params.id === NEW_ENTITY_PATH;
    const router = useRouter();
    const queryClient = useQueryClient();
    const returnEntityName = entityName ?? getEntityName(queryDocument);
    const customFieldConfig = useCustomFieldConfig(returnEntityName);
    const extendedDetailQuery = useExtendedDetailQuery(addCustomFields(queryDocument), pageId);
    const detailQueryOptions = getDetailQueryOptions(extendedDetailQuery, {
        id: isNew ? NEW_ENTITY_ID : params.id,
    });
    const detailQuery = useSuspenseQuery(detailQueryOptions);
    const entityQueryField = entityField ?? getQueryName(extendedDetailQuery);

    const entity = (detailQuery?.data as any)?.[entityQueryField] as
        | DetailPageEntity<T, EntityField>
        | undefined;

    const resetForm = () => {
        form.reset(form.getValues());
    };

    const createMutation = useMutation({
        mutationFn: createDocument ? api.mutate(createDocument) : undefined,
        onSuccess: data => {
            if (createDocument) {
                const createMutationName = getMutationName(createDocument);
                onSuccess?.((data as any)[createMutationName]);
            }
        },
        onError,
    });

    const updateMutation = useMutation({
        mutationFn: updateDocument ? api.mutate(updateDocument) : undefined,
        onSuccess: async data => {
            if (updateDocument) {
                const updateMutationName = getMutationName(updateDocument);
                onSuccess?.((data as any)[updateMutationName]);
                await queryClient.invalidateQueries({ queryKey: detailQueryOptions.queryKey });
                void router.invalidate();
            }
        },
        onError,
    });

    const document = isNew ? (createDocument ?? updateDocument) : updateDocument;
    const { form, submitHandler } = useGeneratedForm({
        document,
        varName: 'input',
        entity,
        customFieldConfig,
        setValues: setValuesForUpdate,
        onSubmit(values: any) {
            const filteredValues = removeReadonlyAndLocalizedCustomFields(values, customFieldConfig || []);

            if (isNew) {
                const finalInput = transformCreateInput?.(filteredValues) ?? filteredValues;
                createMutation.mutate({ input: finalInput });
            } else {
                const finalInput = transformUpdateInput?.(filteredValues) ?? filteredValues;
                updateMutation.mutate({ input: finalInput });
            }
        },
    });

    // A kind of ridiculous workaround to ensure that the `isDirty` and `isValid` properties
    // are always up-to-date when used by the consuming component. This seems to be necessary
    // due to the way that `react-hook-form` uses a Proxy object for the form state.
    // See https://react-hook-form.com/docs/useform/formstate
    // noinspection JSUnusedLocalSymbols
    const { isDirty, isValid } = form.formState;

    return {
        form: form as any,
        submitHandler,
        entity,
        isPending: updateMutation.isPending || detailQuery?.isPending,
        refreshEntity: detailQuery.refetch,
        resetForm,
    };
}
