import { SlugInput } from '@/vdb/components/data-input/index.js';
import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { TranslatableFormFieldWrapper } from '@/vdb/components/shared/translatable-form-field.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Input } from '@/vdb/components/ui/input.js';
import { NEW_ENTITY_PATH } from '@/vdb/constants.js';
import {
    CustomFieldsPageBlock,
    DetailFormGrid,
    Page,
    PageActionBar,
    PageBlock,
    PageLayout,
    PageTitle,
} from '@/vdb/framework/layout-engine/page-layout.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { extendDetailFormQuery } from '@/vdb/framework/document-extension/extend-detail-form-query.js';
import { addCustomFields } from '@/vdb/framework/document-introspection/add-custom-fields.js';
import { getDetailQueryOptions, useDetailPage } from '@/vdb/framework/page/use-detail-page.js';
import { api } from '@/vdb/graphql/api.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { createFileRoute, ParsedLocation, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import {
    createProductOptionDocument,
    productIdNameDocument,
    productOptionDetailDocument,
    productOptionGroupIdNameDocument,
    updateProductOptionDocument,
} from '../_products/product-option-groups.graphql.js';

const pageId = 'option-group-option-detail';

export const Route = createFileRoute(
    '/_authenticated/_option-groups/option-groups_/$groupId/options_/$id',
)({
    component: OptionGroupOptionDetailPage,
    loader: async ({ context, params, location }: { context: any; params: any; location: ParsedLocation }) => {
        if (!params.id) {
            throw new Error('ID param is required');
        }
        const isNew = params.id === NEW_ENTITY_PATH;
        const { extendedQuery: extendedQueryDocument } = extendDetailFormQuery(
            addCustomFields(productOptionDetailDocument),
            pageId,
        );
        const result = isNew
            ? null
            : await context.queryClient.ensureQueryData(
                  getDetailQueryOptions(extendedQueryDocument, { id: params.id }),
              );

        if (!isNew && !result?.productOption) {
            throw new Error(`ProductOption with the ID ${params.id} was not found`);
        }

        let optionGroupName: string | undefined;
        if (isNew) {
            const optionGroupResult = await context.queryClient.fetchQuery({
                queryKey: [pageId, 'optionGroupIdName', params.groupId],
                queryFn: () => api.query(productOptionGroupIdNameDocument, { id: params.groupId }),
            });
            optionGroupName = optionGroupResult.productOptionGroup?.name;
        } else {
            optionGroupName = result.productOption.group.name;
        }

        const search = location.search as Record<string, string>;
        const groupId = isNew ? params.groupId : result.productOption.group.id;

        if (search.from === 'product' && search.productId) {
            const productResult = await context.queryClient.fetchQuery({
                queryKey: [pageId, 'productIdName', search.productId],
                queryFn: () => api.query(productIdNameDocument, { id: search.productId }),
            });
            return {
                breadcrumb: [
                    { path: '/products', label: <Trans>Products</Trans> },
                    { path: `/products/${search.productId}`, label: productResult.product.name },
                    { path: `/products/${search.productId}`, label: <Trans>Option Groups</Trans> },
                    { path: `/option-groups/${groupId}`, label: optionGroupName },
                    isNew ? <Trans>New option</Trans> : result?.productOption?.name,
                ],
            };
        }

        return {
            breadcrumb: [
                { path: '/option-groups', label: <Trans>Option Groups</Trans> },
                ...(isNew
                    ? [<Trans>New option</Trans>]
                    : [
                          { path: `/option-groups/${groupId}`, label: optionGroupName },
                          result?.productOption?.name,
                      ]),
            ],
        };
    },
    errorComponent: ({ error }) => <ErrorPage message={error.message} />,
});

function OptionGroupOptionDetailPage() {
    const params = Route.useParams();
    const navigate = useNavigate();
    const creatingNewEntity = params.id === NEW_ENTITY_PATH;
    const { t } = useLingui();

    const { form, submitHandler, entity, isPending, resetForm } = useDetailPage({
        pageId,
        queryDocument: productOptionDetailDocument,
        createDocument: createProductOptionDocument,
        updateDocument: updateProductOptionDocument,
        setValuesForUpdate: entity => {
            return {
                id: entity.id,
                code: entity.code,
                name: entity.name,
                translations: entity.translations.map(translation => ({
                    id: translation.id,
                    languageCode: translation.languageCode,
                    name: translation.name,
                    customFields: (translation as any).customFields,
                })),
                customFields: entity.customFields as any,
            };
        },
        transformCreateInput: (value): any => {
            return {
                ...value,
                productOptionGroupId: params.groupId,
            };
        },
        params: { id: params.id },
        onSuccess: async data => {
            toast.success(
                creatingNewEntity
                    ? t`Successfully created product option`
                    : t`Successfully updated product option`,
            );
            resetForm();
            const created = Array.isArray(data) ? data[0] : data;
            if (creatingNewEntity && created) {
                await navigate({ to: `../$id`, params: { id: (created as any).id } });
            }
        },
        onError: err => {
            toast.error(
                creatingNewEntity
                    ? t`Failed to create product option`
                    : t`Failed to update product option`,
                {
                    description: err instanceof Error ? err.message : 'Unknown error',
                },
            );
        },
    });

    return (
        <Page pageId={pageId} form={form} submitHandler={submitHandler} entity={entity}>
            <PageTitle>
                {creatingNewEntity ? (
                    <Trans>New product option</Trans>
                ) : (
                    (entity as any)?.name ?? ''
                )}
            </PageTitle>
            <PageActionBar>
                <ActionBarItem
                    itemId="save-button"
                    requiresPermission={['UpdateProduct', 'UpdateCatalog']}
                >
                    <Button
                        type="submit"
                        disabled={!form.formState.isDirty || !form.formState.isValid || isPending}
                    >
                        {creatingNewEntity ? <Trans>Create</Trans> : <Trans>Update</Trans>}
                    </Button>
                </ActionBarItem>
            </PageActionBar>
            <PageLayout>
                {entity?.group && (
                    <PageBlock column="side" blockId="option-group-info">
                        <div className="space-y-2">
                            <div className="text-sm font-medium">
                                <Trans>Option Group</Trans>
                            </div>
                            <div className="text-sm text-muted-foreground">
                                {entity?.group.name}
                            </div>
                            <div className="text-xs text-muted-foreground">
                                {entity?.group.code}
                            </div>
                        </div>
                    </PageBlock>
                )}
                <PageBlock column="main" blockId="main-form">
                    <DetailFormGrid>
                        <TranslatableFormFieldWrapper
                            control={form.control}
                            name="name"
                            label={<Trans>Name</Trans>}
                            render={({ field }) => <Input {...field} />}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="code"
                            label={<Trans>Code</Trans>}
                            render={({ field }) => (
                                <SlugInput
                                    fieldName="code"
                                    watchFieldName="name"
                                    entityName="ProductOption"
                                    entityId={entity?.id}
                                    {...field}
                                />
                            )}
                        />
                    </DetailFormGrid>
                </PageBlock>
                <CustomFieldsPageBlock
                    column="main"
                    entityType="ProductOption"
                    control={form.control}
                />
            </PageLayout>
        </Page>
    );
}
