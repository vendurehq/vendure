import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { TranslatableFormFieldWrapper } from '@/vdb/components/shared/translatable-form-field.js';
import { Button } from '@/vdb/components/ui/button.js';
import { NEW_ENTITY_PATH } from '@/vdb/constants.js';
import { DefaultInputForType } from '@/vdb/framework/form-engine/default-input-for-type.js';
import { useDetailPage } from '@/vdb/framework/page/use-detail-page.js';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { Trans } from '@lingui/react/macro';
import { AnyRoute, useNavigate } from '@tanstack/react-router';
import { ResultOf, VariablesOf } from 'gql.tada';
import { toast } from '@/vdb/components/ui/sonner.js';
import { ControllerRenderProps, FieldPath, FieldValues } from 'react-hook-form';
import {
    FieldInfo,
    getEntityName,
    getOperationVariablesFields,
} from '../document-introspection/get-document-structure.js';
import {
    CustomFieldsPageBlock,
    DetailFormGrid,
    Page,
    PageActionBar,
    PageActionBarRight,
    PageBlock,
    PageLayout,
    PageTitle,
} from '../layout-engine/page-layout.js';
import { DetailEntityPath } from './page-types.js';

/**
 * @description
 * Props to configure the {@link DetailPage} component.
 *
 * @docsCategory detail-views
 * @docsPage DetailPage
 * @since 3.3.0
 */
export interface DetailPageProps<
    T extends TypedDocumentNode<any, any>,
    C extends TypedDocumentNode<any, any>,
    U extends TypedDocumentNode<any, any>,
    EntityField extends keyof ResultOf<T> = DetailEntityPath<T>,
> {
    /**
     * @description
     * The name of the entity.
     * If not provided, it will be inferred from the query document.
     */
    entityName?: string;
    /**
     * @description
     * A unique identifier for the page.
     */
    pageId: string;
    /**
     * @description
     * The Tanstack Router route used to navigate to this page.
     */
    route: AnyRoute;
    /**
     * @description
     * The title of the page.
     */
    title: (entity: ResultOf<T>[EntityField]) => string;
    /**
     * @description
     * The query document used to fetch the entity.
     */
    queryDocument: T;
    /**
     * @description
     * The mutation document used to create the entity.
     */
    createDocument?: C;
    /**
     * @description
     * The mutation document used to update the entity.
     */
    updateDocument: U;
    /**
     * @description
     * A function that sets the values for the update input type based on the entity.
     */
    setValuesForUpdate: (entity: ResultOf<T>[EntityField]) => VariablesOf<U>['input'];
}

export interface DetailPageFieldProps<
    TFieldValues extends FieldValues = FieldValues,
    TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> {
    fieldInfo: FieldInfo;
    field: ControllerRenderProps<TFieldValues, TName>;
}

/**
 * Maps GraphQL schema types (PascalCase) to form engine types (lowercase)
 */
const graphqlTypeMap: Record<string, string> = {
    Int: 'int',
    Float: 'float',
    Boolean: 'boolean',
    DateTime: 'datetime',
    String: 'string',
    ID: 'string',
};

/**
 * Renders form input components based on field type
 */
function FieldInputRenderer<
    TFieldValues extends FieldValues = FieldValues,
    TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({ fieldInfo, field }: DetailPageFieldProps<TFieldValues, TName>) {
    const type = graphqlTypeMap[fieldInfo.type] ?? 'string';
    return (
        <DefaultInputForType
            {...field}
            fieldDef={{ type, name: fieldInfo.name } as any}
        />
    );
}

/**
 * @description
 * Auto-generates a detail page with a form based on the provided query and mutation documents.
 *
 * For more control over the layout, you would use the more low-level {@link Page} component.
 *
 * @docsCategory detail-views
 * @docsPage DetailPage
 * @docsWeight 0
 * @since 3.3.0
 */
export function DetailPage<
    T extends TypedDocumentNode<any, any>,
    C extends TypedDocumentNode<any, any>,
    U extends TypedDocumentNode<any, any>,
>({
    pageId,
    route,
    entityName: passedEntityName,
    queryDocument,
    createDocument,
    updateDocument,
    setValuesForUpdate,
    title,
}: DetailPageProps<T, C, U>) {
    const params = route.useParams();
    const creatingNewEntity = params.id === NEW_ENTITY_PATH;
    const navigate = useNavigate();
    const inferredEntityName = getEntityName(queryDocument);

    const entityName = passedEntityName ?? inferredEntityName;

    const { form, submitHandler, entity, isPending, resetForm } = useDetailPage<any, any, any>({
        queryDocument,
        updateDocument,
        createDocument,
        entityName,
        params: { id: params.id },
        setValuesForUpdate,
        onSuccess: async data => {
            toast.success('Updated successfully');
            resetForm();
            const id = (data as any).id;
            if (creatingNewEntity && id) {
                await navigate({ to: `../$id`, params: { id } });
            }
        },
        onError: error => {
            toast.error('Failed to update', {
                description: error instanceof Error ? error.message : 'Unknown error',
            });
        },
    });

    const updateFields = getOperationVariablesFields(updateDocument, 'input');
    const translations = updateFields.find(fieldInfo => fieldInfo.name === 'translations');

    return (
        <Page pageId={pageId} form={form} submitHandler={submitHandler}>
            <PageTitle>{title(entity)}</PageTitle>
            <PageActionBar>
                <PageActionBarRight>
                    <Button
                        type="submit"
                        disabled={!form.formState.isDirty || !form.formState.isValid || isPending}
                    >
                        <Trans>Update</Trans>
                    </Button>
                </PageActionBarRight>
            </PageActionBar>
            <PageLayout>
                <PageBlock column="main" blockId="main-form">
                    <DetailFormGrid>
                        {updateFields
                            .filter(fieldInfo => fieldInfo.name !== 'customFields')
                            .filter(fieldInfo => fieldInfo.name !== 'translations')
                            .map(fieldInfo => {
                                if (fieldInfo.name === 'id' && fieldInfo.type === 'ID') {
                                    return null;
                                }
                                return (
                                    <FormFieldWrapper
                                        key={fieldInfo.name}
                                        control={form.control}
                                        name={fieldInfo.name as never}
                                        label={fieldInfo.name}
                                        render={({ field }) => (
                                            <FieldInputRenderer fieldInfo={fieldInfo} field={field} />
                                        )}
                                    />
                                );
                            })}
                        {translations?.typeInfo
                            ?.filter(
                                fieldInfo => !['customFields', 'id', 'languageCode'].includes(fieldInfo.name),
                            )
                            .map(fieldInfo => {
                                return (
                                    <TranslatableFormFieldWrapper
                                        key={fieldInfo.name}
                                        control={form.control}
                                        name={fieldInfo.name as never}
                                        label={fieldInfo.name}
                                        render={({ field }) => (
                                            <FieldInputRenderer fieldInfo={fieldInfo} field={field} />
                                        )}
                                    />
                                );
                            })}
                    </DetailFormGrid>
                </PageBlock>
                {entityName && (
                    <CustomFieldsPageBlock column="main" entityType={entityName} control={form.control} />
                )}
            </PageLayout>
        </Page>
    );
}
