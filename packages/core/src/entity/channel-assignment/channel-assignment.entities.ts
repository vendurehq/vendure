import { ID } from '@vendure/common/lib/shared-types';
import { Column } from 'typeorm';

import { ApiKey } from '../api-key/api-key.entity';
import { Asset } from '../asset/asset.entity';
import { Collection } from '../collection/collection.entity';
import {
    CustomApiKeyFields,
    CustomAssetFields,
    CustomCollectionFields,
    CustomCustomerFields,
    CustomFacetFields,
    CustomFacetValueFields,
    CustomOrderFields,
    CustomPaymentMethodFields,
    CustomProductFields,
    CustomProductOptionFields,
    CustomProductOptionGroupFields,
    CustomProductVariantFields,
    CustomPromotionFields,
    CustomShippingMethodFields,
    CustomStockLocationFields,
} from '../custom-entity-fields';
import { Customer } from '../customer/customer.entity';
import { FacetValue } from '../facet-value/facet-value.entity';
import { Facet } from '../facet/facet.entity';
import { Order } from '../order/order.entity';
import { PaymentMethod } from '../payment-method/payment-method.entity';
import { ProductOptionGroup } from '../product-option-group/product-option-group.entity';
import { ProductOption } from '../product-option/product-option.entity';
import { ProductVariant } from '../product-variant/product-variant.entity';
import { Product } from '../product/product.entity';
import { Promotion } from '../promotion/promotion.entity';
import { ShippingMethod } from '../shipping-method/shipping-method.entity';
import { StockLocation } from '../stock-location/stock-location.entity';

import { ChannelAssignment, ChannelAssignmentEntity } from './channel-assignment';

// One channel assignment entity per ChannelAware entity in core. Each owns the junction table of the
// entity's `channels` relation, and is where per-channel columns of that entity are added.

/**
 * @description
 * The assignment of a {@link Asset} to a Channel. See {@link ChannelAssignment}.
 *
 * @docsCategory entities
 * @since 4.0.0
 */
@ChannelAssignmentEntity({
    entity: () => Asset,
    entityProperty: 'asset',
    tableName: 'asset_channels_channel',
    channelOnUpdate: 'CASCADE',
})
export class AssetChannel extends ChannelAssignment {
    assetId: ID;
    asset: Asset;

    /**
     * @description
     * The values of the Asset's channel-scoped custom fields in this Channel. See
     * {@link ChannelAssignment}.
     *
     * @since 4.0.0
     */
    customFields: Partial<CustomAssetFields>;
}

/**
 * @description
 * The assignment of a {@link ApiKey} to a Channel. See {@link ChannelAssignment}.
 *
 * @docsCategory entities
 * @since 4.0.0
 */
@ChannelAssignmentEntity({
    entity: () => ApiKey,
    entityProperty: 'apiKey',
    tableName: 'api_key_channels_channel',
    channelOnUpdate: 'CASCADE',
})
export class ApiKeyChannel extends ChannelAssignment {
    apiKeyId: ID;
    apiKey: ApiKey;

    /**
     * @description
     * The values of the ApiKey's channel-scoped custom fields in this Channel. See
     * {@link ChannelAssignment}.
     *
     * @since 4.0.0
     */
    customFields: Partial<CustomApiKeyFields>;
}

/**
 * @description
 * The assignment of a {@link Collection} to a Channel. See {@link ChannelAssignment}.
 *
 * @docsCategory entities
 * @since 4.0.0
 */
@ChannelAssignmentEntity({
    entity: () => Collection,
    entityProperty: 'collection',
    tableName: 'collection_channels_channel',
})
export class CollectionChannel extends ChannelAssignment {
    collectionId: ID;
    collection: Collection;

    /**
     * @description
     * The values of the Collection's channel-scoped custom fields in this Channel. See
     * {@link ChannelAssignment}.
     *
     * @since 4.0.0
     */
    customFields: Partial<CustomCollectionFields>;
}

/**
 * @description
 * The assignment of a {@link Customer} to a Channel. See {@link ChannelAssignment}.
 *
 * @docsCategory entities
 * @since 4.0.0
 */
@ChannelAssignmentEntity({
    entity: () => Customer,
    entityProperty: 'customer',
    tableName: 'customer_channels_channel',
})
export class CustomerChannel extends ChannelAssignment {
    customerId: ID;
    customer: Customer;

    /**
     * @description
     * The values of the Customer's channel-scoped custom fields in this Channel. See
     * {@link ChannelAssignment}.
     *
     * @since 4.0.0
     */
    customFields: Partial<CustomCustomerFields>;
}

/**
 * @description
 * The assignment of a {@link Facet} to a Channel. See {@link ChannelAssignment}.
 *
 * @docsCategory entities
 * @since 4.0.0
 */
@ChannelAssignmentEntity({
    entity: () => Facet,
    entityProperty: 'facet',
    tableName: 'facet_channels_channel',
})
export class FacetChannel extends ChannelAssignment {
    facetId: ID;
    facet: Facet;

    /**
     * @description
     * The values of the Facet's channel-scoped custom fields in this Channel. See
     * {@link ChannelAssignment}.
     *
     * @since 4.0.0
     */
    customFields: Partial<CustomFacetFields>;
}

/**
 * @description
 * The assignment of a {@link FacetValue} to a Channel. See {@link ChannelAssignment}.
 *
 * @docsCategory entities
 * @since 4.0.0
 */
@ChannelAssignmentEntity({
    entity: () => FacetValue,
    entityProperty: 'facetValue',
    tableName: 'facet_value_channels_channel',
})
export class FacetValueChannel extends ChannelAssignment {
    facetValueId: ID;
    facetValue: FacetValue;

    /**
     * @description
     * The values of the FacetValue's channel-scoped custom fields in this Channel. See
     * {@link ChannelAssignment}.
     *
     * @since 4.0.0
     */
    customFields: Partial<CustomFacetValueFields>;
}

/**
 * @description
 * The assignment of a {@link Order} to a Channel. See {@link ChannelAssignment}.
 *
 * @docsCategory entities
 * @since 4.0.0
 */
@ChannelAssignmentEntity({
    entity: () => Order,
    entityProperty: 'order',
    tableName: 'order_channels_channel',
    channelOnUpdate: 'CASCADE',
})
export class OrderChannel extends ChannelAssignment {
    orderId: ID;
    order: Order;

    /**
     * @description
     * The values of the Order's channel-scoped custom fields in this Channel. See
     * {@link ChannelAssignment}.
     *
     * @since 4.0.0
     */
    customFields: Partial<CustomOrderFields>;
}

/**
 * @description
 * The assignment of a {@link PaymentMethod} to a Channel. See {@link ChannelAssignment}.
 *
 * @docsCategory entities
 * @since 4.0.0
 */
@ChannelAssignmentEntity({
    entity: () => PaymentMethod,
    entityProperty: 'paymentMethod',
    tableName: 'payment_method_channels_channel',
})
export class PaymentMethodChannel extends ChannelAssignment {
    paymentMethodId: ID;
    paymentMethod: PaymentMethod;

    /**
     * @description
     * The values of the PaymentMethod's channel-scoped custom fields in this Channel. See
     * {@link ChannelAssignment}.
     *
     * @since 4.0.0
     */
    customFields: Partial<CustomPaymentMethodFields>;
}

/**
 * @description
 * The assignment of a {@link Product} to a Channel. See {@link ChannelAssignment}.
 *
 * @docsCategory entities
 * @since 4.0.0
 */
@ChannelAssignmentEntity({
    entity: () => Product,
    entityProperty: 'product',
    tableName: 'product_channels_channel',
})
export class ProductChannel extends ChannelAssignment {
    productId: ID;
    product: Product;

    /**
     * @description
     * Whether the Product is enabled in this Channel. It is available in the Channel only if it is
     * also enabled globally (`Product.enabled`): see {@link isEnabledInChannel}.
     *
     * @default true
     * @since 4.0.0
     */
    @Column({ default: true })
    enabled: boolean;

    /**
     * @description
     * The values of the Product's channel-scoped custom fields in this Channel. See
     * {@link ChannelAssignment}.
     *
     * @since 4.0.0
     */
    customFields: Partial<CustomProductFields>;
}

/**
 * @description
 * The assignment of a {@link ProductOption} to a Channel. See {@link ChannelAssignment}.
 *
 * @docsCategory entities
 * @since 4.0.0
 */
@ChannelAssignmentEntity({
    entity: () => ProductOption,
    entityProperty: 'productOption',
    tableName: 'product_option_channels_channel',
})
export class ProductOptionChannel extends ChannelAssignment {
    productOptionId: ID;
    productOption: ProductOption;

    /**
     * @description
     * The values of the ProductOption's channel-scoped custom fields in this Channel. See
     * {@link ChannelAssignment}.
     *
     * @since 4.0.0
     */
    customFields: Partial<CustomProductOptionFields>;
}

/**
 * @description
 * The assignment of a {@link ProductOptionGroup} to a Channel. See {@link ChannelAssignment}.
 *
 * @docsCategory entities
 * @since 4.0.0
 */
@ChannelAssignmentEntity({
    entity: () => ProductOptionGroup,
    entityProperty: 'productOptionGroup',
    tableName: 'product_option_group_channels_channel',
})
export class ProductOptionGroupChannel extends ChannelAssignment {
    productOptionGroupId: ID;
    productOptionGroup: ProductOptionGroup;

    /**
     * @description
     * The values of the ProductOptionGroup's channel-scoped custom fields in this Channel. See
     * {@link ChannelAssignment}.
     *
     * @since 4.0.0
     */
    customFields: Partial<CustomProductOptionGroupFields>;
}

/**
 * @description
 * The assignment of a {@link ProductVariant} to a Channel. See {@link ChannelAssignment}.
 *
 * @docsCategory entities
 * @since 4.0.0
 */
@ChannelAssignmentEntity({
    entity: () => ProductVariant,
    entityProperty: 'productVariant',
    tableName: 'product_variant_channels_channel',
})
export class ProductVariantChannel extends ChannelAssignment {
    productVariantId: ID;
    productVariant: ProductVariant;

    /**
     * @description
     * Whether the ProductVariant is enabled in this Channel. It is available in the Channel only if it is
     * also enabled globally (`ProductVariant.enabled`): see {@link isEnabledInChannel}.
     *
     * @default true
     * @since 4.0.0
     */
    @Column({ default: true })
    enabled: boolean;

    /**
     * @description
     * The values of the ProductVariant's channel-scoped custom fields in this Channel. See
     * {@link ChannelAssignment}.
     *
     * @since 4.0.0
     */
    customFields: Partial<CustomProductVariantFields>;
}

/**
 * @description
 * The assignment of a {@link Promotion} to a Channel. See {@link ChannelAssignment}.
 *
 * @docsCategory entities
 * @since 4.0.0
 */
@ChannelAssignmentEntity({
    entity: () => Promotion,
    entityProperty: 'promotion',
    tableName: 'promotion_channels_channel',
})
export class PromotionChannel extends ChannelAssignment {
    promotionId: ID;
    promotion: Promotion;

    /**
     * @description
     * The values of the Promotion's channel-scoped custom fields in this Channel. See
     * {@link ChannelAssignment}.
     *
     * @since 4.0.0
     */
    customFields: Partial<CustomPromotionFields>;
}

/**
 * @description
 * The assignment of a {@link ShippingMethod} to a Channel. See {@link ChannelAssignment}.
 *
 * @docsCategory entities
 * @since 4.0.0
 */
@ChannelAssignmentEntity({
    entity: () => ShippingMethod,
    entityProperty: 'shippingMethod',
    tableName: 'shipping_method_channels_channel',
})
export class ShippingMethodChannel extends ChannelAssignment {
    shippingMethodId: ID;
    shippingMethod: ShippingMethod;

    /**
     * @description
     * The values of the ShippingMethod's channel-scoped custom fields in this Channel. See
     * {@link ChannelAssignment}.
     *
     * @since 4.0.0
     */
    customFields: Partial<CustomShippingMethodFields>;
}

/**
 * @description
 * The assignment of a {@link StockLocation} to a Channel. See {@link ChannelAssignment}.
 *
 * @docsCategory entities
 * @since 4.0.0
 */
@ChannelAssignmentEntity({
    entity: () => StockLocation,
    entityProperty: 'stockLocation',
    tableName: 'stock_location_channels_channel',
})
export class StockLocationChannel extends ChannelAssignment {
    stockLocationId: ID;
    stockLocation: StockLocation;

    /**
     * @description
     * The values of the StockLocation's channel-scoped custom fields in this Channel. See
     * {@link ChannelAssignment}.
     *
     * @since 4.0.0
     */
    customFields: Partial<CustomStockLocationFields>;
}
