import { MoneyInput } from '@/vdb/components/data-input/money-input.js';
import { NumberInput } from '@/vdb/components/data-input/number-input.js';
import { AssignedFacetValues } from '@/vdb/components/shared/assigned-facet-values.js';
import { CustomFieldsForm } from '@/vdb/components/shared/custom-fields-form.js';
import { EntityAssets } from '@/vdb/components/shared/entity-assets.js';
import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { TaxCategorySelector } from '@/vdb/components/shared/tax-category-selector.js';
import { TranslatableFormFieldWrapper } from '@/vdb/components/shared/translatable-form-field.js';
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
import { usePermissions } from '@/vdb/hooks/use-permissions.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { VariablesOf } from 'gql.tada';
import { Settings2, Trash } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller } from 'react-hook-form';
import { toast } from 'sonner';

import { AddCurrencyDropdown } from './components/add-currency-dropdown.js';
import { AddStockLocationDropdown } from './components/add-stock-location-dropdown.js';
import { VariantOptionSelect } from './components/variant-option-select.js';
import { VariantPriceDetail } from './components/variant-price-detail.js';
import {
    createProductOptionDocument,
    createProductVariantDocument,
    productOptionSlugForEntityDocument,
    productVariantDetailDocument,
    productVariantGlobalSettingsDocument,
    stockLocationsQueryDocument,
    updateProductVariantDocument,
} from './product-variants.graphql.js';
import { findConflictingVariant } from './utils/combination-validation.js';
import { getChangedStockLevels, StockLevelInput } from './utils/stock-levels.js';
import { resolveEffectiveStockSettings } from './utils/stock-settings.js';

const pageId = 'product-variant-detail';

export const Route = createFileRoute('/_authenticated/_product-variants/product-variants_/$id')({
    component: ProductVariantDetailPage,
    loader: detailPageRouteLoader({
        pageId,
        queryDocument: () =>
            addCustomFields(productVariantDetailDocument, {
                includeNestedFragments: ['ProductVariantPrice'],
            }),
        breadcrumb(isNew, entity) {
            // A new variant has no parent entity yet, so fall back to the variants list.
            if (isNew) {
                return [
                    { path: '/product-variants', label: <Trans>Product Variants</Trans> },
                    <Trans>New product variant</Trans>,
                ];
            }
            // For existing variants always link back to the parent product, regardless of
            // entry point (?from=product or the standalone variants list).
            return [
                { path: '/products', label: <Trans>Products</Trans> },
                { path: `/products/${entity?.product.id}`, label: entity?.product.name ?? '' },
                entity?.name,
            ];
        },
    }),
    errorComponent: ({ error }) => <ErrorPage error={error} />,
});

type PriceInput = NonNullable<VariablesOf<typeof updateProductVariantDocument>['input']['prices']>[number];

function ProductVariantDetailPage() {
    const params = Route.useParams();
    const navigate = useNavigate();
    const creatingNewEntity = params.id === NEW_ENTITY_PATH;
    const { t } = useLingui();
    const { activeChannel } = useChannel();
    const { hasPermissions } = usePermissions();
    // Inline option creation calls createProductOption, which requires create permissions
    // server-side — gate the create-new path so it fails with a clear message, not a toast.
    const canCreateOptions = hasPermissions(['CreateProduct', 'CreateCatalog']);

    const { data: stockLocationsData } = useQuery({
        queryKey: ['stockLocations'],
        queryFn: () => api.query(stockLocationsQueryDocument, {}),
    });

    const { data: globalSettingsData } = useQuery({
        queryKey: ['productVariantGlobalStockSettings'],
        queryFn: () => api.query(productVariantGlobalSettingsDocument, {}),
    });

    // Free-text value per option group (the source of truth for the option comboboxes).
    // An entry equal to an existing option's name reassigns to it; any other non-empty
    // value is created as a new option on save.
    const [optionTextByGroup, setOptionTextByGroup] = useState<Record<string, string>>({});
    const [duplicateOptionsError, setDuplicateOptionsError] = useState<string | null>(null);
    const [isSavingOptions, setIsSavingOptions] = useState(false);

    // Holds the stock levels as loaded into the form, so the update transform can
    // tell which ones the admin actually edited (see #4803).
    const originalStockLevelsRef = useRef<StockLevelInput[] | undefined>(undefined);

    const { form, submitHandler, entity, isPending, resetForm } = useDetailPage({
        pageId,
        // OSS-567: the ProductVariant update mutation is patch-style, so send only the fields the
        // user changed and never clobber a concurrent edit to an untouched field.
        sendOnlyChangedFields: true,
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
                optionIds: entity.options.map(option => option.id),
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
    const [prices, taxCategoryId, stockLevels, trackInventory, useGlobalOutOfStockThreshold] = form.watch([
        'prices',
        'taxCategoryId',
        'stockLevels',
        'trackInventory',
        'useGlobalOutOfStockThreshold',
    ]);

    const optionGroups = entity?.product.optionGroups ?? [];

    // Seed the per-group free-text values from the variant's currently assigned options
    // whenever the entity (re)loads.
    useEffect(() => {
        if (!entity) {
            return;
        }
        const initial: Record<string, string> = {};
        for (const group of entity.product.optionGroups) {
            initial[group.id] = entity.options.find(o => o.group.id === group.id)?.name ?? '';
        }
        setOptionTextByGroup(initial);
    }, [entity]);

    // Resolves a group's free text to an existing option, a to-be-created new option, or empty.
    const resolveGroupOption = (
        group: (typeof optionGroups)[number],
        text: string,
    ): { kind: 'existing'; id: string } | { kind: 'new'; name: string } | { kind: 'empty' } => {
        const trimmed = text.trim();
        if (!trimmed) {
            return { kind: 'empty' };
        }
        const match = group.options.find(o => o.name.trim().toLowerCase() === trimmed.toLowerCase());
        return match ? { kind: 'existing', id: match.id } : { kind: 'new', name: trimmed };
    };

    // Commits a group's free text. An exact match to an existing option is written straight
    // into the form's `optionIds` to keep dirty-tracking accurate; a new value leaves
    // `optionIds` untouched and is resolved to a created option on save. Either way the save
    // path (button or Enter) re-resolves the text, so it is the single source of truth.
    const commitGroupText = (group: (typeof optionGroups)[number], text: string) => {
        setOptionTextByGroup(prev => ({ ...prev, [group.id]: text }));
        const resolution = resolveGroupOption(group, text);
        if (resolution.kind === 'existing') {
            const current = form.getValues('optionIds') ?? [];
            const withoutGroup = current.filter(id => !group.options.some(o => o.id === id));
            form.setValue('optionIds', [...withoutGroup, resolution.id], {
                shouldDirty: true,
                shouldValidate: true,
            });
        }
    };

    const anyOptionEmpty = optionGroups.some(group => !(optionTextByGroup[group.id] ?? '').trim());
    const optionsDirty = optionGroups.some(group => {
        const original = entity?.options.find(o => o.group.id === group.id)?.name ?? '';
        return (optionTextByGroup[group.id] ?? '').trim() !== original.trim();
    });

    // A typed value that matches no existing option would create a new one on save, which
    // requires create permissions. Without them the save is blocked with a clear message.
    const hasPendingNewOption = optionGroups.some(
        group => resolveGroupOption(group, optionTextByGroup[group.id] ?? '').kind === 'new',
    );
    const optionCreatePermissionError =
        hasPendingNewOption && !canCreateOptions
            ? t`You do not have permission to create new options. Choose an existing option.`
            : null;

    const createProductOptionMutation = useMutation({
        mutationFn: api.mutate(createProductOptionDocument),
    });

    const createOption = async (group: (typeof optionGroups)[number], name: string) => {
        try {
            // Generate the option code with the server's canonical, uniqueness-checked
            // normalization instead of an ad-hoc slug that ignores punctuation/accents.
            const slugResult = await api.query(productOptionSlugForEntityDocument, {
                input: { entityName: 'ProductOption', fieldName: 'code', inputValue: name },
            });
            const result = await createProductOptionMutation.mutateAsync({
                input: {
                    productOptionGroupId: group.id,
                    code: slugResult.slugForEntity,
                    translations: [{ languageCode: activeChannel?.defaultLanguageCode ?? 'en', name }],
                },
            });
            return result?.createProductOption ?? null;
        } catch (err) {
            toast.error(t`Failed to create option in group "${group.name}"`, {
                description: err instanceof Error ? err.message : t`Unknown error`,
            });
            return null;
        }
    };

    // Validate the selected combination against sibling variants client-side, excluding
    // the variant being edited so it never conflicts with itself. A new (not-yet-created)
    // option value is unique by definition, so conflicts only matter once every group
    // resolves to an existing option.
    const siblingVariants = useMemo(
        () =>
            (entity?.product.variants ?? []).map(variant => ({
                id: variant.id,
                name: variant.name,
                sku: variant.sku,
                optionIds: variant.options.map(o => o.id),
            })),
        [entity?.product.variants],
    );

    useEffect(() => {
        if (!entity) {
            return;
        }
        const resolutions = entity.product.optionGroups.map(group =>
            resolveGroupOption(group, optionTextByGroup[group.id] ?? ''),
        );
        const allExisting = resolutions.length > 0 && resolutions.every(r => r.kind === 'existing');
        if (!allExisting) {
            setDuplicateOptionsError(null);
            return;
        }
        const ids = resolutions.map(r => (r as { kind: 'existing'; id: string }).id);
        const conflict = findConflictingVariant(ids, siblingVariants, entity.id);
        setDuplicateOptionsError(
            conflict
                ? t`A variant with these options already exists: ${conflict.name} (${conflict.sku})`
                : null,
        );
    }, [optionTextByGroup, siblingVariants, entity, t]);

    // Single save path shared by the Update button and the form's native submit (Enter),
    // so Enter can never persist a state the Update button would refuse. Resolves each
    // option group to an id (creating any new options) after guarding against empty and
    // duplicate combinations.
    const saveVariant = async (event: React.SyntheticEvent) => {
        event.preventDefault();
        // Creating a new variant has no options block to resolve; submit directly.
        if (creatingNewEntity) {
            submitHandler(event as unknown as React.FormEvent<HTMLFormElement>);
            return;
        }
        if (!entity) {
            return;
        }
        const resolutions = optionGroups.map(group => ({
            group,
            resolution: resolveGroupOption(group, optionTextByGroup[group.id] ?? ''),
        }));
        // Enforce the same guards as the disabled Update button. Recomputed here (not read
        // from state) so a submit fired before the validation effect settles is still safe.
        if (resolutions.some(r => r.resolution.kind === 'empty')) {
            return;
        }
        // Creating a new option requires create permissions.
        if (!canCreateOptions && resolutions.some(r => r.resolution.kind === 'new')) {
            return;
        }
        const allExisting =
            resolutions.length > 0 && resolutions.every(r => r.resolution.kind === 'existing');
        if (allExisting) {
            const ids = resolutions.map(r => (r.resolution as { kind: 'existing'; id: string }).id);
            if (findConflictingVariant(ids, siblingVariants, entity.id)) {
                return;
            }
        }
        setIsSavingOptions(true);
        try {
            const finalOptionIds: string[] = [];
            for (const { group, resolution } of resolutions) {
                if (resolution.kind === 'existing') {
                    finalOptionIds.push(resolution.id);
                } else if (resolution.kind === 'new') {
                    const created = await createOption(group, resolution.name);
                    if (!created) {
                        return;
                    }
                    finalOptionIds.push(created.id);
                }
            }
            form.setValue('optionIds', finalOptionIds, { shouldDirty: true, shouldValidate: true });
            await submitHandler(event as unknown as React.FormEvent<HTMLFormElement>);
        } finally {
            setIsSavingOptions(false);
        }
    };

    const effectiveStock = resolveEffectiveStockSettings({
        trackInventory: (trackInventory ?? 'INHERIT') as 'INHERIT' | 'TRUE' | 'FALSE',
        useGlobalOutOfStockThreshold: useGlobalOutOfStockThreshold ?? false,
        outOfStockThreshold: form.getValues('outOfStockThreshold'),
        globalSettings: globalSettingsData?.globalSettings,
    });

    const inheritTrackInventoryLabel =
        effectiveStock.globalTrackInventory === undefined
            ? t`Inherit from global settings`
            : effectiveStock.globalTrackInventory
              ? t`Inherit from global settings (Track)`
              : t`Inherit from global settings (Do not track)`;

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
        <Page pageId={pageId} form={form} submitHandler={saveVariant} entity={entity}>
            <PageTitle>
                {creatingNewEntity ? <Trans>New product variant</Trans> : (entity?.name ?? '')}
            </PageTitle>
            <PageActionBar>
                <ActionBarItem itemId="save-button" requiresPermission={['UpdateProduct', 'UpdateCatalog']}>
                    <div className="flex items-center gap-4">
                        <Controller
                            control={form.control}
                            name="enabled"
                            render={({ field }) => (
                                <div
                                    className="flex items-center gap-2"
                                    title={t`When enabled, this variant is available in the shop`}
                                    data-testid="variant-enabled-switch"
                                >
                                    <label
                                        htmlFor="variant-enabled-switch-input"
                                        className="text-sm font-medium"
                                    >
                                        <Trans>Enabled</Trans>
                                    </label>
                                    <Switch
                                        id="variant-enabled-switch-input"
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                    />
                                </div>
                            )}
                        />
                        <Button
                            type="submit"
                            disabled={
                                !(form.formState.isDirty || optionsDirty) ||
                                !form.formState.isValid ||
                                anyOptionEmpty ||
                                !!duplicateOptionsError ||
                                !!optionCreatePermissionError ||
                                isPending ||
                                isSavingOptions
                            }
                        >
                            {creatingNewEntity ? <Trans>Create</Trans> : <Trans>Update</Trans>}
                        </Button>
                    </div>
                </ActionBarItem>
            </PageActionBar>
            <PageLayout>
                {entity && optionGroups.length > 0 && (
                    <PageBlock column="side" blockId="options" title={<Trans>Options</Trans>}>
                        <div className="space-y-3">
                            {optionGroups.map(group => (
                                <VariantOptionSelect
                                    key={group.id}
                                    group={group}
                                    value={optionTextByGroup[group.id] ?? ''}
                                    onValueChange={value => commitGroupText(group, value)}
                                    onSelectOption={optionId => {
                                        const option = group.options.find(o => o.id === optionId);
                                        if (option) {
                                            commitGroupText(group, option.name);
                                        }
                                    }}
                                    invalid={
                                        !(optionTextByGroup[group.id] ?? '').trim() ||
                                        (!canCreateOptions &&
                                            resolveGroupOption(group, optionTextByGroup[group.id] ?? '')
                                                .kind === 'new')
                                    }
                                />
                            ))}
                            {duplicateOptionsError && (
                                <p className="text-sm text-destructive">{duplicateOptionsError}</p>
                            )}
                            {optionCreatePermissionError && (
                                <p className="text-sm text-destructive">{optionCreatePermissionError}</p>
                            )}
                            <Link
                                to={`/products/${entity.product.id}/variants`}
                                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                            >
                                <Settings2 className="h-3.5 w-3.5" />
                                <Trans>Manage option groups</Trans>
                            </Link>
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
                                        INHERIT: inheritTrackInventoryLabel,
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
                                        <SelectItem value="INHERIT">{inheritTrackInventoryLabel}</SelectItem>
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
                            name="useGlobalOutOfStockThreshold"
                            label={<Trans>Use global out-of-stock threshold</Trans>}
                            description={
                                <Trans>
                                    When enabled, this variant uses the global out-of-stock threshold
                                    configured in Settings instead of its own value.
                                </Trans>
                            }
                            render={({ field }) => (
                                <Switch checked={field.value} onCheckedChange={field.onChange} />
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
                                    disabled={effectiveStock.thresholdDisabled}
                                    value={
                                        effectiveStock.thresholdDisabled
                                            ? effectiveStock.displayedThreshold
                                            : field.value
                                    }
                                    onChange={e => field.onChange(e.target.valueAsNumber)}
                                />
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
