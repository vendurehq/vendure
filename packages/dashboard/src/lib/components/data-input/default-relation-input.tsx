import { graphql } from '@/vdb/graphql/graphql.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMemo } from 'react';
import { MultiRelationInput, SingleRelationInput } from './relation-input.js';
import { createRelationSelectorConfig } from './relation-selector.js';

import {
    DashboardFormComponentMetadata,
    DashboardFormComponentProps,
    RelationCustomFieldConfig,
} from '@/vdb/framework/form-engine/form-engine-types.js';
import { isRelationCustomFieldConfig } from '@/vdb/framework/form-engine/utils.js';

interface PlaceholderIconProps {
    letter: string;
    className?: string;
    rounded?: boolean;
}

function PlaceholderIcon({ letter, className = '', rounded = false }: Readonly<PlaceholderIconProps>) {
    return (
        <div
            className={`w-full h-full bg-muted flex items-center justify-center border rounded text-muted-foreground ${rounded ? 'text-sm font-medium' : 'text-xs'} ${className}`}
        >
            {letter}
        </div>
    );
}

interface EntityLabelProps {
    title: string;
    subtitle: string;
    imageUrl?: string;
    placeholderLetter: string;
    statusIndicator?: React.ReactNode;
    rounded?: boolean;
    tooltipText?: string;
}

interface StatusBadgeProps {
    condition: boolean;
    text: string;
    variant?: 'orange' | 'green' | 'red' | 'blue';
}

function StatusBadge({ condition, text, variant = 'orange' }: Readonly<StatusBadgeProps>) {
    if (!condition) return null;

    const colorClasses = {
        orange: 'text-warning',
        green: 'bg-success/10 text-success',
        red: 'bg-destructive/10 text-destructive',
        blue: 'bg-primary/10 text-primary',
    };

    return (
        <span
            className={`ml-2 text-xs ${variant === 'orange' ? colorClasses.orange : `px-1.5 py-0.5 rounded-full ${colorClasses[variant]}`}`}
        >
            • {text}
        </span>
    );
}

function EntityLabel({
    title,
    subtitle,
    imageUrl,
    placeholderLetter,
    statusIndicator,
    rounded = false,
    tooltipText,
}: Readonly<EntityLabelProps>) {
    return (
        <div className="flex items-center gap-3 w-full" title={tooltipText || `${title} (${subtitle})`}>
            <div
                className={`w-8 h-8 ${rounded ? 'rounded-full' : 'rounded overflow-hidden'} bg-muted flex-shrink-0`}
            >
                {imageUrl ? (
                    <img
                        src={imageUrl + '?preset=thumb'}
                        alt={title}
                        className="w-full h-full object-cover"
                    />
                ) : (
                    <PlaceholderIcon letter={placeholderLetter} rounded={rounded} />
                )}
            </div>
            <div className="flex-1 min-w-0">
                <div className="font-medium truncate">
                    {title}
                    {statusIndicator}
                </div>
                <div className="text-sm text-muted-foreground truncate">{subtitle}</div>
            </div>
        </div>
    );
}

function createBaseEntityConfig(
    entityName: string,
    i18n: any,
    labelKey: 'name' | 'code' | 'emailAddress' = 'name',
    searchField: string = 'name',
) {
    const entityNameLower = entityName.toLowerCase();
    return {
        idKey: 'id',
        labelKey,
        placeholder: i18n`Search ${entityNameLower}...`,
        buildSearchFilter: (term: string) => ({
            [searchField]: { contains: term },
        }),
    } as const;
}

function getOrderStateVariant(state: string): StatusBadgeProps['variant'] {
    switch (state) {
        case 'Delivered':
            return 'green';
        case 'Cancelled':
            return 'red';
        default:
            return 'blue';
    }
}

// Entity type mappings from the dev-config.ts - using functions to generate configs
const createEntityConfigs = (i18n: any) => ({
    Product: createRelationSelectorConfig({
        ...createBaseEntityConfig('Product', i18n),
        listQuery: graphql(`
            query GetProductsForRelationSelector($options: ProductListOptions) {
                products(options: $options) {
                    items {
                        id
                        name
                        slug
                        enabled
                        featuredAsset {
                            id
                            preview
                        }
                    }
                    totalItems
                }
            }
        `),
        label: (item: any) => (
            <EntityLabel
                title={item.name}
                subtitle={`${item.slug}${!item.enabled ? ' • Disabled' : ''}`}
                imageUrl={item.featuredAsset?.preview}
                placeholderLetter="P"
                tooltipText={`${item.name} (${item.slug})`}
            />
        ),
    }),

    Customer: createRelationSelectorConfig({
        ...createBaseEntityConfig('Customer', i18n, 'emailAddress', 'emailAddress'),
        listQuery: graphql(`
            query GetCustomersForRelationSelector($options: CustomerListOptions) {
                customers(options: $options) {
                    items {
                        id
                        firstName
                        lastName
                        emailAddress
                        phoneNumber
                        user {
                            verified
                        }
                    }
                    totalItems
                }
            }
        `),
        label: (item: any) => (
            <EntityLabel
                title={`${item.firstName} ${item.lastName}`}
                subtitle={[item.emailAddress, item.phoneNumber].filter(Boolean).join(' • ')}
                placeholderLetter={
                    item.firstName?.[0]?.toUpperCase() || item.emailAddress?.[0]?.toUpperCase() || 'U'
                }
                rounded
                statusIndicator={<StatusBadge condition={!item.user?.verified} text="Unverified" />}
                tooltipText={`${item.firstName} ${item.lastName} (${item.emailAddress})`}
            />
        ),
    }),

    ProductVariant: createRelationSelectorConfig({
        ...createBaseEntityConfig('Product Variant', i18n),
        listQuery: graphql(`
            query GetProductVariantsForRelationSelector($options: ProductVariantListOptions) {
                productVariants(options: $options) {
                    items {
                        id
                        name
                        sku
                        enabled
                        stockOnHand
                        product {
                            name
                            featuredAsset {
                                id
                                preview
                            }
                        }
                        featuredAsset {
                            id
                            preview
                        }
                    }
                    totalItems
                }
            }
        `),
        label: (item: any) => (
            <EntityLabel
                title={`${item.product.name} - ${item.name}`}
                subtitle={`SKU: ${item.sku} • Stock: ${item.stockOnHand ?? 0}`}
                imageUrl={item.featuredAsset?.preview || item.product.featuredAsset?.preview}
                placeholderLetter="V"
                statusIndicator={<StatusBadge condition={!item.enabled} text="Disabled" />}
                tooltipText={`${item.product.name} - ${item.name} (SKU: ${item.sku})`}
            />
        ),
    }),

    Collection: createRelationSelectorConfig({
        ...createBaseEntityConfig('Collection', i18n),
        listQuery: graphql(`
            query GetCollectionsForRelationSelector($options: CollectionListOptions) {
                collections(options: $options) {
                    items {
                        id
                        name
                        slug
                        isPrivate
                        position
                        productVariantCount
                        featuredAsset {
                            id
                            preview
                        }
                    }
                    totalItems
                }
            }
        `),
        label: (item: any) => (
            <EntityLabel
                title={item.name}
                subtitle={`${item.slug} • ${item.productVariantCount || 0} products`}
                imageUrl={item.featuredAsset?.preview}
                placeholderLetter="C"
                statusIndicator={<StatusBadge condition={item.isPrivate} text="Private" />}
                tooltipText={`${item.name} (${item.slug})`}
            />
        ),
    }),

    Facet: createRelationSelectorConfig({
        ...createBaseEntityConfig('Facet', i18n),
        listQuery: graphql(`
            query GetFacetsForRelationSelector($options: FacetListOptions) {
                facets(options: $options) {
                    items {
                        id
                        name
                        code
                        isPrivate
                        valueList {
                            totalItems
                        }
                    }
                    totalItems
                }
            }
        `),
        label: (item: any) => (
            <EntityLabel
                title={item.name}
                subtitle={`${item.code} • ${item.valueList?.totalItems || 0} values`}
                placeholderLetter="F"
                rounded
                statusIndicator={<StatusBadge condition={item.isPrivate} text="Private" />}
                tooltipText={`${item.name} (${item.code})`}
            />
        ),
    }),

    FacetValue: createRelationSelectorConfig({
        ...createBaseEntityConfig('Facet Value', i18n),
        listQuery: graphql(`
            query GetFacetValuesForRelationSelector($options: FacetValueListOptions) {
                facetValues(options: $options) {
                    items {
                        id
                        name
                        code
                        facet {
                            name
                            code
                        }
                    }
                    totalItems
                }
            }
        `),
        label: (item: any) => (
            <EntityLabel
                title={item.name}
                subtitle={`${item.facet.name} • ${item.code}`}
                placeholderLetter="FV"
                rounded
                tooltipText={`${item.facet.name}: ${item.name} (${item.code})`}
            />
        ),
    }),

    Asset: createRelationSelectorConfig({
        ...createBaseEntityConfig('Asset', i18n),
        listQuery: graphql(`
            query GetAssetsForRelationSelector($options: AssetListOptions) {
                assets(options: $options) {
                    items {
                        id
                        name
                        preview
                        source
                        mimeType
                        fileSize
                        width
                        height
                    }
                    totalItems
                }
            }
        `),
        label: (item: any) => {
            const dimensions = item.width && item.height ? `${item.width}×${item.height}` : '';
            const fileSize = item.fileSize ? `${Math.round(item.fileSize / 1024)}KB` : '';
            const subtitle = [item.mimeType, dimensions, fileSize].filter(Boolean).join(' • ');
            const tooltipDetails = [item.mimeType, dimensions, fileSize].filter(Boolean).join(', ');

            return (
                <EntityLabel
                    title={item.name}
                    subtitle={subtitle}
                    imageUrl={item.preview}
                    placeholderLetter="A"
                    tooltipText={`${item.name} (${tooltipDetails})`}
                />
            );
        },
    }),

    Order: createRelationSelectorConfig({
        ...createBaseEntityConfig('Order', i18n, 'code', 'code'),
        listQuery: graphql(`
            query GetOrdersForRelationSelector($options: OrderListOptions) {
                orders(options: $options) {
                    items {
                        id
                        code
                        state
                        totalWithTax
                        currencyCode
                        orderPlacedAt
                        customer {
                            firstName
                            lastName
                            emailAddress
                        }
                    }
                    totalItems
                }
            }
        `),
        label: (item: any) => {
            const stateVariant = getOrderStateVariant(item.state);
            return (
                <EntityLabel
                    title={item.code}
                    subtitle={`${item.customer?.firstName} ${item.customer?.lastName} • ${item.totalWithTax / 100} ${item.currencyCode}`}
                    placeholderLetter="O"
                    rounded
                    statusIndicator={
                        <StatusBadge condition={true} text={item.state} variant={stateVariant} />
                    }
                    tooltipText={`${item.code} - ${item.customer?.firstName} ${item.customer?.lastName} (${item.totalWithTax / 100} ${item.currencyCode})`}
                />
            );
        },
    }),

    // OrderLine: Not available as a list query in the admin API, fallback to basic input

    ShippingMethod: createRelationSelectorConfig({
        ...createBaseEntityConfig('Shipping Method', i18n),
        listQuery: graphql(`
            query GetShippingMethodsForRelationSelector($options: ShippingMethodListOptions) {
                shippingMethods(options: $options) {
                    items {
                        id
                        name
                        code
                        description
                        fulfillmentHandlerCode
                    }
                    totalItems
                }
            }
        `),
        label: (item: any) => (
            <EntityLabel
                title={item.name}
                subtitle={`${item.code} • ${item.fulfillmentHandlerCode}`}
                placeholderLetter="S"
                rounded
                tooltipText={`${item.name} (${item.code})`}
            />
        ),
    }),

    PaymentMethod: createRelationSelectorConfig({
        ...createBaseEntityConfig('Payment Method', i18n),
        listQuery: graphql(`
            query GetPaymentMethodsForRelationSelector($options: PaymentMethodListOptions) {
                paymentMethods(options: $options) {
                    items {
                        id
                        name
                        code
                        description
                        enabled
                        handler {
                            code
                        }
                    }
                    totalItems
                }
            }
        `),
        label: (item: any) => (
            <EntityLabel
                title={item.name}
                subtitle={`${item.code} • ${item.handler?.code}`}
                placeholderLetter="P"
                rounded
                statusIndicator={<StatusBadge condition={!item.enabled} text="Disabled" />}
                tooltipText={`${item.name} (${item.code})`}
            />
        ),
    }),

    Channel: createRelationSelectorConfig({
        ...createBaseEntityConfig('Channel', i18n, 'code', 'code'),
        listQuery: graphql(`
            query GetChannelsForRelationSelector($options: ChannelListOptions) {
                channels(options: $options) {
                    items {
                        id
                        code
                        token
                        defaultLanguageCode
                        currencyCode
                        pricesIncludeTax
                    }
                    totalItems
                }
            }
        `),
        label: (item: any) => (
            <EntityLabel
                title={item.code}
                subtitle={`${item.defaultLanguageCode} • ${item.currencyCode} • ${item.pricesIncludeTax ? 'Inc. Tax' : 'Ex. Tax'}`}
                placeholderLetter="CH"
                rounded
                tooltipText={`${item.code} (${item.defaultLanguageCode}, ${item.currencyCode})`}
            />
        ),
    }),

    CustomerGroup: createRelationSelectorConfig({
        ...createBaseEntityConfig('Customer Group', i18n),
        listQuery: graphql(`
            query GetCustomerGroupsForRelationSelector($options: CustomerGroupListOptions) {
                customerGroups(options: $options) {
                    items {
                        id
                        name
                        customers {
                            totalItems
                        }
                    }
                    totalItems
                }
            }
        `),
        label: (item: any) => (
            <EntityLabel
                title={item.name}
                subtitle={`${item.customers?.totalItems || 0} customers`}
                placeholderLetter="CG"
                rounded
                tooltipText={`${item.name} (${item.customers?.totalItems || 0} customers)`}
            />
        ),
    }),

    Promotion: createRelationSelectorConfig({
        ...createBaseEntityConfig('Promotion', i18n),
        listQuery: graphql(`
            query GetPromotionsForRelationSelector($options: PromotionListOptions) {
                promotions(options: $options) {
                    items {
                        id
                        name
                        couponCode
                        enabled
                        startsAt
                        endsAt
                    }
                    totalItems
                }
            }
        `),
        label: (item: any) => {
            const parts = [
                item.couponCode,
                item.startsAt && `Starts: ${new Date(item.startsAt).toLocaleDateString()}`,
                item.endsAt && `Ends: ${new Date(item.endsAt).toLocaleDateString()}`,
            ].filter(Boolean);

            return (
                <EntityLabel
                    title={item.name}
                    subtitle={parts.join(' • ')}
                    placeholderLetter="PR"
                    rounded
                    statusIndicator={<StatusBadge condition={!item.enabled} text="Disabled" />}
                    tooltipText={item.couponCode ? `${item.name} (${item.couponCode})` : item.name}
                />
            );
        },
    }),

    Administrator: createRelationSelectorConfig({
        idKey: 'id',
        labelKey: 'lastName',
        placeholder: i18n`Search administrator...`,
        // Match the search term against any of the name/email fields independently
        buildSearchFilter: (term: string) => ({
            _or: [
                { firstName: { contains: term } },
                { lastName: { contains: term } },
                { emailAddress: { contains: term } },
            ],
        }),
        listQuery: graphql(`
            query GetAdministratorsForRelationSelector($options: AdministratorListOptions) {
                administrators(options: $options) {
                    items {
                        id
                        firstName
                        lastName
                        emailAddress
                    }
                    totalItems
                }
            }
        `),
        label: (item: any) => (
            <EntityLabel
                title={`${item.firstName} ${item.lastName}`}
                subtitle={item.emailAddress}
                placeholderLetter={item.firstName?.[0]?.toUpperCase() || 'A'}
                rounded
                tooltipText={`${item.firstName} ${item.lastName} (${item.emailAddress})`}
            />
        ),
    }),

    Seller: createRelationSelectorConfig({
        ...createBaseEntityConfig('Seller', i18n),
        listQuery: graphql(`
            query GetSellersForRelationSelector($options: SellerListOptions) {
                sellers(options: $options) {
                    items {
                        id
                        name
                    }
                    totalItems
                }
            }
        `),
        label: (item: any) => (
            <EntityLabel
                title={item.name}
                subtitle={''}
                placeholderLetter={item.name?.[0]?.toUpperCase() || 'S'}
                rounded
                tooltipText={item.name}
            />
        ),
    }),
});

type DefaultRelationInputProps = DashboardFormComponentProps & {
    entityType?: keyof ReturnType<typeof createEntityConfigs>;
};

export function DefaultRelationInput({
    fieldDef,
    value,
    onChange,
    onBlur,
    name,
    ref,
    disabled,
    entityType,
}: Readonly<DefaultRelationInputProps>) {
    const { t } = useLingui();
    const ENTITY_CONFIGS = useMemo(() => createEntityConfigs(t), [t]);
    if (!fieldDef || (!isRelationCustomFieldConfig(fieldDef) && !entityType)) {
        return null;
    }
    const entityName = entityType ?? (fieldDef as RelationCustomFieldConfig).entity;
    const config = ENTITY_CONFIGS[entityName as keyof typeof ENTITY_CONFIGS];

    if (!config) {
        // Fallback to plain input if entity type not found
        console.warn(`No relation selector config found for entity: ${entityName}`);
        return (
            <input
                value={value ?? ''}
                onChange={e => onChange(e.target.value)}
                onBlur={onBlur}
                name={name}
                disabled={disabled}
                placeholder={`Enter ${entityName} ID`}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
        );
    }

    const isList = fieldDef.list ?? false;

    if (isList) {
        return (
            <MultiRelationInput
                onBlur={onBlur}
                name={name}
                ref={ref}
                value={value ?? []}
                onChange={onChange}
                config={config}
                disabled={disabled}
                selectorLabel={<Trans>Select {entityName.toLowerCase()}s</Trans>}
            />
        );
    } else {
        return (
            <SingleRelationInput
                onBlur={onBlur}
                name={name}
                ref={ref}
                value={value}
                onChange={onChange}
                config={config}
                disabled={disabled}
                selectorLabel={<Trans>Select {entityName.toLowerCase()}</Trans>}
            />
        );
    }
}

DefaultRelationInput.metadata = {
    isListInput: 'dynamic',
} as DashboardFormComponentMetadata;
