import { SlugInput } from '@/vdb/components/data-input/index.js';
import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { TranslatableFormFieldWrapper } from '@/vdb/components/shared/translatable-form-field.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Input } from '@/vdb/components/ui/input.js';
import { NEW_ENTITY_PATH } from '@/vdb/constants.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
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
import { Trans, useLingui } from '@lingui/react/macro';
import { createFileRoute, ParsedLocation, useLocation, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { AssignedChannels } from '@/vdb/components/shared/assigned-channels.js';
import { api } from '@/vdb/graphql/api.js';
import { OptionGroupProductsBlock } from './components/option-group-products-block.js';
import { ProductOptionsTable } from '../_products/components/product-options-table.js';
import {
    assignOptionGroupsToChannelDocument,
    removeOptionGroupsFromChannelDocument,
} from './option-groups.graphql.js';
import {
    createProductOptionGroupDocument,
    productIdNameDocument,
    productOptionGroupDetailDocument,
    updateProductOptionGroupDocument,
} from '../_products/product-option-groups.graphql.js';

const pageId = 'option-group-detail';

export const Route = createFileRoute('/_authenticated/_option-groups/option-groups_/$id')({
    component: OptionGroupDetailPage,
    loader: async ({ context, params, location }: { context: any; params: any; location: ParsedLocation }) => {
        if (!params.id) {
            throw new Error('ID param is required');
        }
        const isNew = params.id === NEW_ENTITY_PATH;
        const { extendedQuery: extendedQueryDocument } = extendDetailFormQuery(
            addCustomFields(productOptionGroupDetailDocument),
            pageId,
        );
        const result = isNew
            ? null
            : await context.queryClient.ensureQueryData(
                  getDetailQueryOptions(extendedQueryDocument, { id: params.id }),
              );

        if (!isNew && !result.productOptionGroup) {
            throw new Error(`ProductOptionGroup with the ID ${params.id} was not found`);
        }

        const search = location.search as Record<string, string>;
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
                    isNew ? <Trans>New option group</Trans> : result?.productOptionGroup?.name,
                ],
            };
        }

        return {
            breadcrumb: [
                { path: '/option-groups', label: <Trans>Option Groups</Trans> },
                isNew ? <Trans>New option group</Trans> : result?.productOptionGroup?.name,
            ],
        };
    },
    errorComponent: ({ error }) => <ErrorPage message={error.message} />,
});

function OptionGroupDetailPage() {
    const params = Route.useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const search = location.search as Record<string, string>;
    const creatingNewEntity = params.id === NEW_ENTITY_PATH;
    const { t } = useLingui();
    const { channels } = useChannel();

    const { form, submitHandler, entity, isPending, resetForm } = useDetailPage({
        pageId,
        queryDocument: productOptionGroupDetailDocument,
        createDocument: createProductOptionGroupDocument,
        updateDocument: updateProductOptionGroupDocument,
        setValuesForUpdate: entity => {
            return {
                id: entity.id,
                code: entity.code,
                translations: entity.translations.map(translation => ({
                    id: translation.id,
                    languageCode: translation.languageCode,
                    name: translation.name,
                    customFields: (translation as any).customFields,
                })),
                customFields: entity.customFields,
            };
        },
        transformCreateInput: values => {
            return {
                ...values,
                options: [],
            };
        },
        params: { id: params.id },
        onSuccess: async data => {
            toast.success(
                creatingNewEntity
                    ? t`Successfully created option group`
                    : t`Successfully updated option group`,
            );
            resetForm();
            if (creatingNewEntity) {
                await navigate({ to: `../$id`, params: { id: data.id } });
            }
        },
        onError: err => {
            toast.error(
                creatingNewEntity
                    ? t`Failed to create option group`
                    : t`Failed to update option group`,
                {
                    description: err instanceof Error ? err.message : 'Unknown error',
                },
            );
        },
    });

    return (
        <Page pageId={pageId} form={form} submitHandler={submitHandler} entity={entity}>
            <PageTitle>
                {creatingNewEntity ? <Trans>New option group</Trans> : (entity?.name ?? '')}
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
                                    entityName="ProductOptionGroup"
                                    entityId={entity?.id}
                                    {...field}
                                />
                            )}
                        />
                    </DetailFormGrid>
                </PageBlock>
                <CustomFieldsPageBlock
                    column="main"
                    entityType="ProductOptionGroup"
                    control={form.control}
                />
                {entity && (
                    <PageBlock
                        column="main"
                        blockId="product-options"
                        title={<Trans>Product Options</Trans>}
                    >
                        <ProductOptionsTable
                            productOptionGroupId={entity.id}
                            getOptionHref={optionId =>
                                `/option-groups/${entity.id}/options/${optionId}`
                            }
                            newOptionHref={`/option-groups/${entity.id}/options/new`}
                            linkSearch={search.from === 'product' ? search : undefined}
                        />
                    </PageBlock>
                )}
                {entity && (
                    <PageBlock column="side" blockId="products" title={<Trans>Products</Trans>}>
                        <OptionGroupProductsBlock optionGroupId={entity.id} />
                    </PageBlock>
                )}
                {channels.length > 1 && entity && (
                    <PageBlock column="side" blockId="channels" title={<Trans>Channels</Trans>}>
                        <AssignedChannels
                            channels={entity.channels}
                            entityId={entity.id}
                            entityType="option group"
                            canUpdate={!creatingNewEntity}
                            assignMutationFn={api.mutate(assignOptionGroupsToChannelDocument)}
                            removeMutationFn={api.mutate(removeOptionGroupsFromChannelDocument)}
                            buildRemoveInput={(eid, channelId) => ({
                                productOptionGroupIds: [eid],
                                channelId,
                            })}
                            buildAssignInput={(eid, channelId) => ({
                                productOptionGroupIds: [eid],
                                channelId,
                            })}
                            queryKeyScope={['DetailPage', 'productOptionGroup']}
                        />
                    </PageBlock>
                )}
            </PageLayout>
        </Page>
    );
}
