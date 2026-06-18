import { RichTextInput } from '@/vdb/components/data-input/rich-text-input.js';
import { SlugInput } from '@/vdb/components/data-input/slug-input.js';
import { AssignedFacetValues } from '@/vdb/components/shared/assigned-facet-values.js';
import { EntityAssets } from '@/vdb/components/shared/entity-assets.js';
import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { TranslatableFormFieldWrapper } from '@/vdb/components/shared/translatable-form-field.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Field } from '@/vdb/components/ui/field.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Switch } from '@/vdb/components/ui/switch.js';
import { NEW_ENTITY_PATH } from '@/vdb/constants.js';
import {    CustomFieldsPageBlock,
    DetailFormGrid,
    Page,
    PageActionBar,
    PageBlock,
    PageLayout,
    PageTitle,
} from '@/vdb/framework/layout-engine/page-layout.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { detailPageRouteLoader } from '@/vdb/framework/page/detail-page-route-loader.js';
import { useDetailPage } from '@/vdb/framework/page/use-detail-page.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { Layers, Package, PlusIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { AddOptionGroupDialog } from './components/add-option-group-dialog.js';
import { GenerateVariantsPanel } from './components/generate-variants-panel.js';
import { ProductOptionGroupBadge } from './components/product-option-group-badge.js';
import { ProductVariantsTable } from './components/product-variants-table.js';
import {
    assignProductsToChannelDocument,
    createProductDocument,
    productDetailDocument,
    removeOptionGroupFromProductDocument,
    removeProductsFromChannelDocument,
    updateProductDocument,
} from './products.graphql.js';
import { api } from '@/vdb/graphql/api.js';
import { AssignedChannels } from '@/vdb/components/shared/assigned-channels.js';
import { usePriceFactor } from '@/vdb/components/shared/assign-to-channel-dialog.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';

const pageId = 'product-detail';

export const Route = createFileRoute('/_authenticated/_products/products_/$id')({
    component: ProductDetailPage,
    loader: detailPageRouteLoader({
        pageId,
        queryDocument: productDetailDocument,
        breadcrumb(isNew, entity) {
            return [
                { path: '/products', label: <Trans>Products</Trans> },
                isNew ? <Trans>New product</Trans> : entity?.name,
            ];
        },
    }),
    errorComponent: ({ error }) => <ErrorPage message={error.message} />,
});

function NoVariantsPrompt({
    productId,
    productName,
    onOptionGroupCreated,
    onVariantCreated,
}: Readonly<{
    productId: string;
    productName: string;
    onOptionGroupCreated: () => void;
    onVariantCreated: () => void;
}>) {
    const [mode, setMode] = useState<'choose' | 'single'>('choose');

    if (mode === 'single') {
        return (
            <GenerateVariantsPanel
                productId={productId}
                productName={productName}
                optionGroups={[]}
                onSuccess={onVariantCreated}
                onBack={{ handler: () => setMode('choose') }}
            />
        );
    }

    return (
        <div className="grid grid-cols-2 gap-3">
            <button
                type="button"
                onClick={() => setMode('single')}
                className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border p-6 text-center transition-colors hover:border-primary hover:bg-accent cursor-pointer"
            >
                <Package className="h-8 w-8 text-muted-foreground" />
                <span className="font-medium"><Trans>Simple product</Trans></span>
                <span className="text-sm text-muted-foreground">
                    <Trans>Single variant, no options</Trans>
                </span>
            </button>
            <AddOptionGroupDialog
                productId={productId}
                existingGroupIds={[]}
                onSuccess={onOptionGroupCreated}
                trigger={
                    <button
                        type="button"
                        className="flex w-full flex-col items-center gap-2 rounded-md border border-dashed border-border p-6 text-center transition-colors hover:border-primary hover:bg-accent cursor-pointer"
                    >
                        <Layers className="h-8 w-8 text-muted-foreground" />
                        <span className="font-medium"><Trans>Product with options</Trans></span>
                        <span className="text-sm text-muted-foreground">
                            <Trans>Size, colour, etc.</Trans>
                        </span>
                    </button>
                }
            />
        </div>
    );
}

function ProductDetailPage() {
    const params = Route.useParams();
    const navigate = useNavigate();
    const creatingNewEntity = params.id === NEW_ENTITY_PATH;
    const { t } = useLingui();
    const refreshRef = useRef<() => void>(() => {});
    const { channels } = useChannel();
    const { priceFactor, priceFactorField } = usePriceFactor();

    const { form, submitHandler, entity, isPending, refreshEntity, resetForm } = useDetailPage({
        pageId,
        entityName: 'Product',
        queryDocument: productDetailDocument,
        createDocument: createProductDocument,
        updateDocument: updateProductDocument,
        setValuesForUpdate: entity => {
            return {
                id: entity.id,
                enabled: entity.enabled,
                featuredAssetId: entity.featuredAsset?.id,
                assetIds: entity.assets.map(asset => asset.id),
                facetValueIds: entity.facetValues.map(facetValue => facetValue.id),
                channelIds: entity.channels.map(c => c.id) ?? [],
                translations: entity.translations.map(translation => ({
                    id: translation.id,
                    languageCode: translation.languageCode,
                    name: translation.name,
                    slug: translation.slug,
                    description: translation.description,
                    customFields: (translation as any).customFields,
                })),
                customFields: entity.customFields as any,
            };
        },
        params: { id: params.id },
        onSuccess: async data => {
            toast.success(
                creatingNewEntity ? t`Successfully created product` : t`Successfully updated product`,
            );
            resetForm();
            if (creatingNewEntity) {
                await navigate({ to: `../$id`, params: { id: data.id } });
            }
        },
        onError: err => {
            toast.error(creatingNewEntity ? t`Failed to create product` : t`Failed to update product`, {
                description: err instanceof Error ? err.message : 'Unknown error',
            });
        },
    });

    const removeOptionGroupMutation = useMutation({
        mutationFn: api.mutate(removeOptionGroupFromProductDocument),
    });

    const removeAllOptionGroups = async (
        productId: string,
        optionGroups: Array<{ id: string }>,
    ) => {
        try {
            for (const group of optionGroups) {
                const result = await removeOptionGroupMutation.mutateAsync({
                    productId,
                    optionGroupId: group.id,
                });
                const removeResult = result?.removeOptionGroupFromProduct;
                if (
                    removeResult &&
                    '__typename' in removeResult &&
                    removeResult.__typename === 'ProductOptionInUseError'
                ) {
                    toast.error(t`Could not remove option group`, {
                        description: removeResult.message,
                    });
                    refreshEntity();
                    return;
                }
            }
            refreshEntity();
        } catch (error) {
            toast.error(t`Failed to remove option groups`, {
                description: error instanceof Error ? error.message : t`Unknown error`,
            });
            refreshEntity();
        }
    };

    return (
        <Page pageId={pageId} form={form} submitHandler={submitHandler} entity={entity}>
            <PageTitle>{creatingNewEntity ? <Trans>New product</Trans> : (entity?.name ?? '')}</PageTitle>
            <PageActionBar>
                <ActionBarItem itemId="save-button" requiresPermission={['UpdateProduct', 'UpdateCatalog']}>
                    <Button
                        type="submit"
                        disabled={!form.formState.isDirty || !form.formState.isValid || isPending}
                    >
                        {creatingNewEntity ? <Trans>Create</Trans> : <Trans>Update</Trans>}
                    </Button>
                </ActionBarItem>
            </PageActionBar>
            <PageLayout>
                <PageBlock column="side" blockId="enabled-toggle">
                    <FormFieldWrapper
                        control={form.control}
                        name="enabled"
                        label={<Trans>Enabled</Trans>}
                        description={<Trans>When enabled, a product is available in the shop</Trans>}
                        render={({ field }) => (
                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                        )}
                    />
                </PageBlock>
                <PageBlock column="main" blockId="main-form">
                    <DetailFormGrid>
                        <TranslatableFormFieldWrapper
                            control={form.control}
                            name="name"
                            label={<Trans>Product name</Trans>}
                            render={({ field }) => <Input {...field} />}
                        />
                        <TranslatableFormFieldWrapper
                            control={form.control}
                            name="slug"
                            label={<Trans>Slug</Trans>}
                            render={({ field }) => (
                                <SlugInput
                                    {...field}
                                    entityName="Product"
                                    fieldName="slug"
                                    watchFieldName="name"
                                    entityId={entity?.id}
                                />
                            )}
                        />
                    </DetailFormGrid>

                    <TranslatableFormFieldWrapper
                        control={form.control}
                        name="description"
                        label={<Trans>Description</Trans>}
                        render={({ field }) => <RichTextInput {...field} />}
                    />
                </PageBlock>
                <CustomFieldsPageBlock column="main" entityType="Product" control={form.control} />
                {entity && entity.variantList.totalItems > 0 && (
                    <PageBlock column="main" blockId="product-variants-table">
                        <ProductVariantsTable
                            productId={params.id}
                            registerRefresher={refresher => {
                                refreshRef.current = refresher;
                            }}
                            fromProductDetailPage={true}
                        />
                        <div className="mt-4 flex gap-2">
                            <Button render={<Link to="./variants" />} variant="outline">
                                <PlusIcon className="mr-2 h-4 w-4" />
                                <Trans>Manage variants</Trans>
                            </Button>
                        </div>
                    </PageBlock>
                )}
                {entity && entity.variantList.totalItems === 0 && (
                    <PageBlock
                        column="main"
                        blockId="generate-variants"
                        title={<Trans>Product variants</Trans>}
                    >
                        {entity.optionGroups.length === 0 ? (
                            <NoVariantsPrompt
                                productId={entity.id}
                                productName={entity.name}
                                onOptionGroupCreated={() => refreshEntity()}
                                onVariantCreated={() => refreshEntity()}
                            />
                        ) : (
                            <GenerateVariantsPanel
                                productId={entity.id}
                                productName={entity.name}
                                optionGroups={entity.optionGroups}
                                onSuccess={() => refreshEntity()}
                                onBack={{
                                    handler: () => removeAllOptionGroups(entity.id, entity.optionGroups),
                                    confirmation: {
                                        title: t`Remove option groups?`,
                                        description: t`This will remove all option groups from this product and return to the variant setup choice.`,
                                    },
                                }}
                            />
                        )}
                    </PageBlock>
                )}
                {entity && entity.optionGroups.length > 0 && (
                    <PageBlock column="side" blockId="option-groups" title={<Trans>Product Options</Trans>}>
                        <div className="flex flex-wrap gap-1.5 mb-3">
                            {entity.optionGroups.map(g => (
                                <ProductOptionGroupBadge
                                    key={g.id}
                                    id={g.id}
                                    name={g.name}
                                    productId={entity.id}
                                />
                            ))}
                        </div>
                        <AddOptionGroupDialog
                            productId={entity.id}
                            existingGroupIds={entity.optionGroups.map(g => g.id)}
                            onSuccess={() => refreshEntity()}
                        />
                    </PageBlock>
                )}
                <PageBlock column="side" blockId="facet-values" title={<Trans>Facet Values</Trans>}>
                    <FormFieldWrapper
                        control={form.control}
                        name="facetValueIds"
                        render={({ field }) => (
                            <AssignedFacetValues facetValues={entity?.facetValues ?? []} {...field} />
                        )}
                    />
                </PageBlock>
                {channels.length > 1 && entity && (
                    <PageBlock column="side" blockId="channels" title={<Trans>Channels</Trans>}>
                        <AssignedChannels
                            channels={entity.channels}
                            entityId={entity.id}
                            entityType="product"
                            canUpdate={!creatingNewEntity}
                            assignMutationFn={api.mutate(assignProductsToChannelDocument)}
                            removeMutationFn={api.mutate(removeProductsFromChannelDocument)}
                            buildRemoveInput={(eid, channelId) => ({
                                productIds: [eid],
                                channelId,
                            })}
                            buildAssignInput={(eid, channelId) => ({
                                productIds: [eid],
                                channelId,
                                priceFactor,
                            })}
                            additionalAssignFields={priceFactorField}
                            queryKeyScope={['DetailPage', 'product']}
                        />
                    </PageBlock>
                )}

                <PageBlock column="side" blockId="assets" title={<Trans>Assets</Trans>}>
                    <Field>
                        <EntityAssets
                            assets={entity?.assets}
                            featuredAsset={entity?.featuredAsset}
                            compact={true}
                            value={form.getValues()}
                            onChange={value => {
                                form.setValue('featuredAssetId', value.featuredAssetId ?? undefined, {
                                    shouldDirty: true,
                                    shouldValidate: true,
                                });
                                form.setValue('assetIds', value.assetIds ?? [], {
                                    shouldDirty: true,
                                    shouldValidate: true,
                                });
                            }}
                        />
                    </Field>
                </PageBlock>
            </PageLayout>
        </Page>
    );
}
