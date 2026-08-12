import { Address } from './address/address.entity';
import { Administrator } from './administrator/administrator.entity';
import { ApiKeyTranslation } from './api-key/api-key-translation.entity';
import { ApiKey } from './api-key/api-key.entity';
import { AssetTranslation } from './asset/asset-translation.entity';
import { Asset } from './asset/asset.entity';
import { AuthenticationMethod } from './authentication-method/authentication-method.entity';
import { ExternalAuthenticationMethod } from './authentication-method/external-authentication-method.entity';
import { NativeAuthenticationMethod } from './authentication-method/native-authentication-method.entity';
import { Channel } from './channel/channel.entity';
import { CollectionAsset } from './collection/collection-asset.entity';
import { CollectionTranslation } from './collection/collection-translation.entity';
import { Collection } from './collection/collection.entity';
import { CustomerGroup } from './customer-group/customer-group.entity';
import { Customer } from './customer/customer.entity';
import { FacetValueTranslation } from './facet-value/facet-value-translation.entity';
import { FacetValue } from './facet-value/facet-value.entity';
import { FacetTranslation } from './facet/facet-translation.entity';
import { Facet } from './facet/facet.entity';
import { Fulfillment } from './fulfillment/fulfillment.entity';
import { GlobalSettings } from './global-settings/global-settings.entity';
import { CustomerHistoryEntry } from './history-entry/customer-history-entry.entity';
import { HistoryEntry } from './history-entry/history-entry.entity';
import { OrderHistoryEntry } from './history-entry/order-history-entry.entity';
import { FulfillmentLine } from './order-line-reference/fulfillment-line.entity';
import { OrderLineReference } from './order-line-reference/order-line-reference.entity';
import { OrderModificationLine } from './order-line-reference/order-modification-line.entity';
import { RefundLine } from './order-line-reference/refund-line.entity';
import { OrderLine } from './order-line/order-line.entity';
import { OrderModification } from './order-modification/order-modification.entity';
import { Order } from './order/order.entity';
import { PaymentMethodTranslation } from './payment-method/payment-method-translation.entity';
import { PaymentMethod } from './payment-method/payment-method.entity';
import { Payment } from './payment/payment.entity';
import { ProductOptionGroupTranslation } from './product-option-group/product-option-group-translation.entity';
import { ProductOptionGroup } from './product-option-group/product-option-group.entity';
import { ProductOptionTranslation } from './product-option/product-option-translation.entity';
import { ProductOption } from './product-option/product-option.entity';
import { ProductVariantAsset } from './product-variant/product-variant-asset.entity';
import { ProductVariantPrice } from './product-variant/product-variant-price.entity';
import { ProductVariantTranslation } from './product-variant/product-variant-translation.entity';
import { ProductVariant } from './product-variant/product-variant.entity';
import { ProductAsset } from './product/product-asset.entity';
import { ProductTranslation } from './product/product-translation.entity';
import { Product } from './product/product.entity';
import { PromotionTranslation } from './promotion/promotion-translation.entity';
import { Promotion } from './promotion/promotion.entity';
import { Refund } from './refund/refund.entity';
import { Country } from './region/country.entity';
import { Province } from './region/province.entity';
import { RegionTranslation } from './region/region-translation.entity';
import { Region } from './region/region.entity';
import { ChannelRole } from './role/channel-role.entity';
import { Role } from './role/role.entity';
import { Seller } from './seller/seller.entity';
import { AnonymousSession } from './session/anonymous-session.entity';
import { AuthenticatedSession } from './session/authenticated-session.entity';
import { Session } from './session/session.entity';
import { SettingsStoreEntry } from './settings-store-entry/settings-store-entry.entity';
import { ShippingLine } from './shipping-line/shipping-line.entity';
import { ShippingMethodTranslation } from './shipping-method/shipping-method-translation.entity';
import { ShippingMethod } from './shipping-method/shipping-method.entity';
import { StockLevel } from './stock-level/stock-level.entity';
import { StockLocation } from './stock-location/stock-location.entity';
import { Allocation } from './stock-movement/allocation.entity';
import { Cancellation } from './stock-movement/cancellation.entity';
import { Release } from './stock-movement/release.entity';
import { Sale } from './stock-movement/sale.entity';
import { StockAdjustment } from './stock-movement/stock-adjustment.entity';
import { StockMovement } from './stock-movement/stock-movement.entity';
import { Surcharge } from './surcharge/surcharge.entity';
import { Tag } from './tag/tag.entity';
import { TaxCategory } from './tax-category/tax-category.entity';
import { TaxRate } from './tax-rate/tax-rate.entity';
import { User } from './user/user.entity';
import { Zone } from './zone/zone.entity';

/**
 * A map of all the core database entities.
 */
export const coreEntitiesMap = {
    Address,
    Administrator,
    Allocation,
    AnonymousSession,
    ApiKey,
    ApiKeyTranslation,
    Asset,
    AssetTranslation,
    AuthenticatedSession,
    AuthenticationMethod,
    Cancellation,
    Channel,
    ChannelRole,
    Collection,
    CollectionAsset,
    CollectionTranslation,
    Country,
    Customer,
    CustomerGroup,
    CustomerHistoryEntry,
    ExternalAuthenticationMethod,
    Facet,
    FacetTranslation,
    FacetValue,
    FacetValueTranslation,
    Fulfillment,
    FulfillmentLine,
    GlobalSettings,
    HistoryEntry,
    NativeAuthenticationMethod,
    OrderModificationLine,
    Order,
    OrderHistoryEntry,
    OrderLine,
    OrderLineReference,
    OrderModification,
    Payment,
    PaymentMethod,
    PaymentMethodTranslation,
    Product,
    ProductAsset,
    ProductOption,
    ProductOptionGroup,
    ProductOptionGroupTranslation,
    ProductOptionTranslation,
    ProductTranslation,
    ProductVariant,
    ProductVariantAsset,
    ProductVariantPrice,
    ProductVariantTranslation,
    Promotion,
    PromotionTranslation,
    Province,
    Refund,
    RefundLine,
    Region,
    RegionTranslation,
    Release,
    Role,
    Sale,
    Session,
    SettingsStoreEntry,
    ShippingLine,
    ShippingMethod,
    ShippingMethodTranslation,
    StockAdjustment,
    StockLevel,
    StockLocation,
    StockMovement,
    Surcharge,
    Tag,
    TaxCategory,
    TaxRate,
    User,
    Seller,
    Zone,
};
