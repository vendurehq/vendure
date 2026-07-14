import { MoneyInput } from '@/vdb/components/data-input/money-input.js';
import { NumberInput } from '@/vdb/components/data-input/number-input.js';
import { AssignedFacetValues } from '@/vdb/components/shared/assigned-facet-values.js';
import { CustomFieldsForm } from '@/vdb/components/shared/custom-fields-form.js';
import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import { EntityAssets } from '@/vdb/components/shared/entity-assets.js';
import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { TaxCategorySelector } from '@/vdb/components/shared/tax-category-selector.js';
import { TranslatableFormFieldWrapper } from '@/vdb/components/shared/translatable-form-field.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Field, FieldLabel } from '@/vdb/components/ui/field.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/vdb/components/ui/select.js';
import { Separator } from '@/vdb/components/ui/separator.js';
import { Switch } from '@/vdb/components/ui/switch.js';
import { NEW_ENTITY_PATH } from '@/vdb/constants.js';
import { addCustomFields } from '@/vdb/framework/document-introspection/add-custom-fields.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import {
    CustomFieldsPageBlock,
    DetailFormGrid,
    Page,
    PageActionBar,
    PageBlock,
    PageLayout,
    PageTitle,
} from '@/vdb/framework/layout-engine/page-layout.js';
import { detailPageRouteLoader } from '@/vdb/framework/page/detail-page-route-loader.js';
import { useDetailPage } from '@/vdb/framework/page/use-detail-page.js';
import { api } from '@/vdb/graphql/api.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { VariablesOf } from 'gql.tada';
import { Edit2, Trash } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { AddCurrencyDropdown } from './components/add-currency-dropdown.js';
import { AddStockLocationDropdown } from './components/add-stock-location-dropdown.js';
import { VariantPriceDetail } from './components/variant-price-detail.js';
import {
    createProductVariantDocument,
    productVariantDetailDocument,
    stockLocationsQueryDocument,
    updateProductVariantDocument,
} from './product-variants.graphql.js';
import { getChangedStockLevels, StockLevelInput } from './utils/stock-levels.js';

const pageId = 'product-variant-detail';

export const Route = createFileRoute('/_authenticated/_product-variants/product-variants_/$id')({
    component: ProductVariantDetailPage,
    loader: detailPageRouteLoader({
        pageId,
        queryDocument: () =>
            addCustomFields(productVariantDetailDocument, {
                includeNestedFragments: ['ProductVariantPrice'],
            }),
        breadcrumb(_isNew, entity, location) {
            if ((location.search as any).from === 'product') {
                return [
                    { path: '/products', label: <Trans>Products</Trans> },
                    { path: `/products/${entity?.product.id}`, label: entity?.product.name ?? '' },
                    entity?.name,
                ];
            }
            return [{ path: '/product-variants', label: <Trans>Product Variants</Trans> }, entity?.name];
        },
    }),
    errorComponent: ({ error }) => <ErrorPage message={error.message} />,
});

type PriceInput = NonNullable<VariablesOf<typeof updateProductVariantDocument>['input']['prices']>[number];

function ProductVariantDetailPage() {
    const params = Route.useParams();
    const navigate = useNavigate();
    const creatingNewEntity = params.id === NEW_ENTITY_PATH;
    const { t } = useLingui();
    const { activeChannel } = useChannel();

    const { data: stockLocationsData } = useQuery({
        queryKey: ['stockLocations'],
        queryFn: () => api.query(stockLocationsQueryDocument, {}),
    });

    // Holds the stock levels as loaded into the form, so the update transform can
    // tell which ones the admin actually edited (see #4803).
    const originalStockLevelsRef = useRef<StockLevelInput[] | undefined>(undefined);

    const { form, submitHandler, entity, isPending, resetForm } = useDetailPage({
        pageId,
        queryDocument: addCustomFields(productVariantDetailDocument, {
            includeNestedFragments: ['ProductVariantPrice'],
        }),
        createDocument: createProductVariantDocument,
        updateDocument: updateProductVariantDocument,
        setValuesForUpdate: entity => {
            return {
                id: entity.id,
                enabled: entity.enabled,
                sku: entity.sku,
                featuredAssetId: entity.featuredAsset?.id,
                assetIds: entity.assets.map(asset => asset.id),
                facetValueIds: entity.facetValues.map(facetValue => facetValue.id),
                taxCategoryId: entity.taxCategory.id,
                price: entity.price,
                prices: entity.prices,
                trackInventory: entity.trackInventory,
                outOfStockThreshold: entity.outOfStockThreshold,
                useGlobalOutOfStockThreshold: entity.useGlobalOutOfStockThreshold,
                stockLevels: entity.stockLevels.map(stockLevel => ({
                    stockOnHand: stockLevel.stockOnHand,
                    stockLocationId: stockLevel.stockLocation.id,
                })),
                translations: entity.translations.map(translation => ({
                    id: translation.id,
                    languageCode: translation.languageCode,
                    name: translation.name,
                    customFields: (translation as any).customFields,
                })),
                customFields: entity.customFields,
            };
        },
        transformUpdateInput: input => {
            // Only send stock levels the admin actually edited — see getChangedStockLevels
            // and #4803 for why resending unchanged stock is destructive.
            const changedStockLevels = getChangedStockLevels(
                input.stockLevels,
                originalStockLevelsRef.current,
            );
            if (changedStockLevels.length === 0) {
                const { stockLevels: _omittedStockLevels, ...rest } = input;
                return rest;
            }
            return { ...input, stockLevels: changedStockLevels };
        },
        params: { id: params.id },
        onSuccess: data => {
            toast.success(
                creatingNewEntity
                    ? t`Successfully created product variant`
                    : t`Successfully updated product variant`,
            );
            resetForm();
            if (creatingNewEntity) {
                navigate({ to: `../${(data as any)?.[0]?.id}`, from: Route.id });
            }
        },
        onError: err => {
            toast.error(
                creatingNewEntity ? t`Failed to create product variant` : t`Failed to update product variant`,
                {
                    description: err instanceof Error ? err.message : 'Unknown error',
                },
            );
        },
    });

    useEffect(() => {
        originalStockLevelsRef.current = entity?.stockLevels.map(stockLevel => ({
            stockLocationId: stockLevel.stockLocation.id,
            stockOnHand: stockLevel.stockOnHand,
        }));
    }, [entity]);

    const availableCurrencies = activeChannel?.availableCurrencyCodes ?? [];
    const [prices, taxCategoryId, stockLevels] = form.watch(['prices', 'taxCategoryId', 'stockLevels']);

    // Filter out deleted prices for display
    const activePrices = prices?.filter(p => !p.delete) ?? [];

    // Get currencies that are currently active (not deleted)
    const usedCurrencies = activePrices.map(p => p.currencyCode);
    const unusedCurrencies = availableCurrencies.filter(c => !usedCurrencies.includes(c));

    // Get used stock location IDs
    const usedStockLocationIds = stockLevels?.map(sl => sl.stockLocationId) ?? [];

    const handleAddCurrency = (currencyCode: string) => {
        const currentPrices = form.getValues('prices') || [];

        // Check if this currency already exists (including deleted ones)
        const existingPriceIndex = currentPrices.findIndex(p => p.currencyCode === currencyCode);

        if (existingPriceIndex !== -1) {
            // Currency exists, mark it as not deleted
            const updatedPrices = [...currentPrices];
            updatedPrices[existingPriceIndex] = {
                ...updatedPrices[existingPriceIndex],
                delete: false,
            };
            form.setValue('prices', updatedPrices, {
                shouldDirty: true,
                shouldValidate: true,
            });
        } else {
            // Add new currency
            const newPrice = {
                currencyCode,
                price: 0,
                delete: false,
                customFields: {},
            } as PriceInput;
            form.setValue('prices', [...currentPrices, newPrice], {
                shouldDirty: true,
                shouldValidate: true,
            });
        }
    };

    const handleRemoveCurrency = (indexToRemove: number) => {
        const currentPrices = form.getValues('prices') || [];
        const updatedPrices = [...currentPrices];
        updatedPrices[indexToRemove] = {
            ...updatedPrices[indexToRemove],
            delete: true,
        };
        form.setValue('prices', updatedPrices, {
            shouldDirty: true,
            shouldValidate: true,
        });
    };

    const handleAddStockLocation = (stockLocationId: string, stockLocationName: string) => {
        const currentStockLevels = form.getValues('stockLevels') || [];
        const newStockLevel = {
            stockLocationId,
            stockOnHand: 0,
        };
        form.setValue('stockLevels', [...currentStockLevels, newStockLevel], {
            shouldDirty: true,
            shouldValidate: true,
        });
    };

    return (
        <Page pageId={pageId} form={form} submitHandler={submitHandler} entity={entity}>
            <PageTitle>
                {creatingNewEntity ? <Trans>New product variant</Trans> : (entity?.name ?? '')}
            </PageTitle>
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
                <PageBlock column="side" blockId="enabled">
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
                {entity?.options && entity.options.length > 0 && (
                    <PageBlock column="side" blockId="options" title={<Trans>Options</Trans>}>
                        <div className="flex flex-wrap gap-1.5">
                            {entity.options.map(option => (
                                <Badge key={option.id} variant="secondary" className="text-xs" title={option.code}>
                                    <span>{option.group.name}: {option.name}</span>
                                    <Link
                                        to={`/option-groups/${option.group.id}`}
                                        className="ml-1.5 inline-flex"
                                    >
                                        <Edit2 className="h-3 w-3" />
                                    </Link>
                                </Badge>
                            ))}
                        </div>
                    </PageBlock>
                )}
                <PageBlock column="main" blockId="main-form">
                    <DetailFormGrid>
                        <TranslatableFormFieldWrapper
                            control={form.control}
                            name="name"
                            label={<Trans>Variant name</Trans>}
                            render={({ field }) => <Input {...field} />}
                        />

                        <FormFieldWrapper
                            control={form.control}
                            name="sku"
                            label={<Trans>SKU</Trans>}
                            render={({ field }) => <Input {...field} />}
                        />
                    </DetailFormGrid>
                </PageBlock>
                <CustomFieldsPageBlock column="main" entityType="ProductVariant" control={form.control} />

                <PageBlock column="main" blockId="price-and-tax" title={<Trans>Price and tax</Trans>}>
                    <DetailFormGrid>
                        <FormFieldWrapper
                            control={form.control}
                            name="taxCategoryId"
                            label={<Trans>Tax category</Trans>}
                            render={({ field }) => (
                                <TaxCategorySelector value={field.value} onChange={field.onChange} />
                            )}
                        />
                    </DetailFormGrid>
                    {activePrices.map((price, displayIndex) => {
                        // Find the actual index in the full prices array
                        const actualIndex = prices?.indexOf(price) ?? displayIndex;

                        const currencyCodeLabel = (
                            <div className="uppercase text-muted-foreground">{price.currencyCode}</div>
                        );
                        const priceLabel = (
                            <div className="flex gap-1 items-center justify-between">
                                <Trans>Price</Trans> {activePrices.length > 1 ? currencyCodeLabel : null}
                            </div>
                        );
                        return (
                            <div key={price.currencyCode} className="space-y-6">
                                {displayIndex > 0 && <Separator className="my-4" />}
                                <DetailFormGrid key={price.currencyCode}>
                                    <div className="flex gap-1 items-end">
                                        <FormFieldWrapper
                                            control={form.control}
                                            name={`prices.${actualIndex}.price`}
                                            label={priceLabel}
                                            render={({ field }) => (
                                                <MoneyInput {...field} currency={price.currencyCode} />
                                            )}
                                        />
                                        {activePrices.length > 1 && (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleRemoveCurrency(actualIndex)}
                                                className="h-6 w-6 p-0 mb-2 hover:text-destructive hover:bg-destructive-100"
                                            >
                                                <Trash className="size-4" />
                                            </Button>
                                        )}
                                    </div>
                                    <VariantPriceDetail
                                        priceIncludesTax={activeChannel?.pricesIncludeTax ?? false}
                                        price={price.price}
                                        currencyCode={
                                            price.currencyCode ?? activeChannel?.defaultCurrencyCode ?? ''
                                        }
                                        taxCategoryId={taxCategoryId}
                                    />
                                </DetailFormGrid>
                                {/* Custom fields for ProductVariantPrice */}
                                <CustomFieldsForm
                                    entityType="ProductVariantPrice"
                                    control={form.control}
                                    formPathPrefix={`prices.${actualIndex}`}
                                />
                            </div>
                        );
                    })}
                    {unusedCurrencies.length ? (
                        <AddCurrencyDropdown
                            onCurrencySelect={handleAddCurrency}
                            unusedCurrencies={unusedCurrencies}
                        />
                    ) : null}
                </PageBlock>
                <PageBlock column="main" blockId="stock" title={<Trans>Stock</Trans>}>
                    <DetailFormGrid>
                        <FormFieldWrapper
                            control={form.control}
                            name="trackInventory"
                            label={<Trans>Stock levels</Trans>}
                            renderFormControl={false}
                            render={({ field }) => (
                                <Select
                                    items={{
                                        INHERIT: t`Inherit from global settings`,
                                        TRUE: t`Track`,
                                        FALSE: t`Do not track`,
                                    }}
                                    onValueChange={val => {
                                        if (val) {
                                            field.onChange(val);
                                        }
                                    }}
                                    value={field.value}
                                >
                                    <SelectTrigger className="">
                                        <SelectValue placeholder="Track inventory" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="INHERIT">
                                            <Trans>Inherit from global settings</Trans>
                                        </SelectItem>
                                        <SelectItem value="TRUE">
                                            <Trans>Track</Trans>
                                        </SelectItem>
                                        <SelectItem value="FALSE">
                                            <Trans>Do not track</Trans>
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            )}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="outOfStockThreshold"
                            label={<Trans>Out-of-stock threshold</Trans>}
                            description={
                                <Trans>
                                    Sets the stock level at which this variant is considered to be out of
                                    stock. Using a negative value enables backorder support.
                                </Trans>
                            }
                            render={({ field }) => (
                                <Input
                                    type="number"
                                    value={field.value}
                                    onChange={e => field.onChange(e.target.valueAsNumber)}
                                />
                            )}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="useGlobalOutOfStockThreshold"
                            label={<Trans>Use global out-of-stock threshold</Trans>}
                            description={
                                <Trans>
                                    Sets the stock level at which this variant is considered to be out of
                                    stock. Using a negative value enables backorder support.
                                </Trans>
                            }
                            render={({ field }) => (
                                <Switch checked={field.value} onCheckedChange={field.onChange} />
                            )}
                        />
                    </DetailFormGrid>
                    {stockLevels?.map((stockLevel, index) => {
                        const stockAllocated =
                            entity?.stockLevels.find(sl => sl.stockLocation.id === stockLevel.stockLocationId)
                                ?.stockAllocated ?? 0;
                        const stockLocationName = stockLocationsData?.stockLocations.items?.find(
                            sl => sl.id === stockLevel.stockLocationId,
                        )?.name;
                        const stockLocationNameLabel =
                            stockLevels.length > 1 ? (
                                <div className="text-muted-foreground">{stockLocationName}</div>
                            ) : null;
                        const stockLabel = (
                            <>
                                <Trans>Stock level</Trans>
                                {stockLocationNameLabel}
                            </>
                        );
                        return (
                            <DetailFormGrid key={stockLevel.stockLocationId}>
                                <FormFieldWrapper
                                    control={form.control}
                                    name={`stockLevels.${index}.stockOnHand`}
                                    label={stockLabel}
                                    render={({ field }) => <NumberInput {...field} value={field.value} />}
                                />
                                <div>
                                    <Field>
                                        <FieldLabel>
                                            <Trans>Allocated</Trans>
                                        </FieldLabel>
                                        <div className="text-sm pt-1.5">{stockAllocated}</div>
                                    </Field>
                                </div>
                            </DetailFormGrid>
                        );
                    })}
                    <AddStockLocationDropdown
                        availableStockLocations={stockLocationsData?.stockLocations.items ?? []}
                        usedStockLocationIds={usedStockLocationIds}
                        onStockLocationSelect={handleAddStockLocation}
                    />
                </PageBlock>

                <PageBlock column="side" blockId="facet-values" title={<Trans>Facet Values</Trans>}>
                    <FormFieldWrapper
                        control={form.control}
                        name="facetValueIds"
                        render={({ field }) => (
                            <AssignedFacetValues facetValues={entity?.facetValues ?? []} {...field} />
                        )}
                    />
                </PageBlock>

                <PageBlock column="side" blockId="parent-product" title={<Trans>Parent product</Trans>}>
                    <DetailPageButton
                        label={entity?.product.name}
                        href={`/products/${entity?.product.id}`}
                        className="border"
                    />
                </PageBlock>
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
                                form.setValue('assetIds', value.assetIds ?? undefined, {
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
