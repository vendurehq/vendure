import { Module } from '@nestjs/common';

import { CacheModule } from '../cache/cache.module';
import { ConfigModule } from '../config/config.module';
import { ConnectionModule } from '../connection/connection.module';
import { DataImportModule } from '../data-import/data-import.module';
import { JobQueueModule } from '../job-queue/job-queue.module';
import { createDynamicGraphQlModulesForPlugins } from '../plugin/dynamic-plugin-api.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { ServiceModule } from '../service/service.module';

import { ConfigurableOperationCodec } from './common/configurable-operation-codec';
import { CustomFieldRelationResolverService } from './common/custom-field-relation-resolver.service';
import { IdCodecService } from './common/id-codec.service';
import { AdministratorResolver } from './resolvers/admin/administrator.resolver';
import { ApiKeyResolver } from './resolvers/admin/api-key.resolver';
import { AssetResolver } from './resolvers/admin/asset.resolver';
import { AuthResolver } from './resolvers/admin/auth.resolver';
import { ChannelResolver } from './resolvers/admin/channel.resolver';
import { CollectionResolver } from './resolvers/admin/collection.resolver';
import { CountryResolver } from './resolvers/admin/country.resolver';
import { CustomerGroupResolver } from './resolvers/admin/customer-group.resolver';
import { CustomerResolver } from './resolvers/admin/customer.resolver';
import { DraftOrderResolver } from './resolvers/admin/draft-order.resolver';
import { DuplicateEntityResolver } from './resolvers/admin/duplicate-entity.resolver';
import { FacetResolver } from './resolvers/admin/facet.resolver';
import { GlobalSettingsResolver } from './resolvers/admin/global-settings.resolver';
import { ImportResolver } from './resolvers/admin/import.resolver';
import { JobResolver } from './resolvers/admin/job.resolver';
import { OrderResolver } from './resolvers/admin/order.resolver';
import { PaymentMethodResolver } from './resolvers/admin/payment-method.resolver';
import { ProductOptionResolver } from './resolvers/admin/product-option.resolver';
import { ProductResolver } from './resolvers/admin/product.resolver';
import { PromotionResolver } from './resolvers/admin/promotion.resolver';
import { RoleResolver } from './resolvers/admin/role.resolver';
import { ScheduledTaskResolver } from './resolvers/admin/scheduled-task.resolver';
import { SearchResolver } from './resolvers/admin/search.resolver';
import { SellerResolver } from './resolvers/admin/seller.resolver';
import { SettingsStoreAdminResolver } from './resolvers/admin/settings-store.resolver';
import { ShippingMethodResolver } from './resolvers/admin/shipping-method.resolver';
import { SlugResolver } from './resolvers/admin/slug.resolver';
import { StockLocationResolver } from './resolvers/admin/stock-location.resolver';
import { TagResolver } from './resolvers/admin/tag.resolver';
import { TaxCategoryResolver } from './resolvers/admin/tax-category.resolver';
import { TaxRateResolver } from './resolvers/admin/tax-rate.resolver';
import { ZoneResolver } from './resolvers/admin/zone.resolver';
import { AdministratorEntityResolver } from './resolvers/entity/administrator-entity.resolver';
import { AssetEntityResolver } from './resolvers/entity/asset-entity.resolver';
import { ChannelEntityResolver } from './resolvers/entity/channel-entity.resolver';
import { CollectionEntityResolver } from './resolvers/entity/collection-entity.resolver';
import { CountryEntityResolver } from './resolvers/entity/country-entity.resolver';
import {
    CustomerAdminEntityResolver,
    CustomerEntityResolver,
} from './resolvers/entity/customer-entity.resolver';
import { CustomerGroupEntityResolver } from './resolvers/entity/customer-group-entity.resolver';
import { FacetEntityResolver } from './resolvers/entity/facet-entity.resolver';
import { FacetValueEntityResolver } from './resolvers/entity/facet-value-entity.resolver';
import {
    FulfillmentAdminEntityResolver,
    FulfillmentEntityResolver,
} from './resolvers/entity/fulfillment-entity.resolver';
import { FulfillmentLineEntityResolver } from './resolvers/entity/fulfillment-line-entity.resolver';
import { JobEntityResolver } from './resolvers/entity/job-entity.resolver';
import { OrderAdminEntityResolver, OrderEntityResolver } from './resolvers/entity/order-entity.resolver';
import { OrderLineEntityResolver } from './resolvers/entity/order-line-entity.resolver';
import {
    PaymentAdminEntityResolver,
    PaymentEntityResolver,
} from './resolvers/entity/payment-entity.resolver';
import { PaymentMethodEntityResolver } from './resolvers/entity/payment-method-entity.resolver';
import {
    ProductAdminEntityResolver,
    ProductEntityResolver,
} from './resolvers/entity/product-entity.resolver';
import { ProductOptionEntityResolver } from './resolvers/entity/product-option-entity.resolver';
import {
    ProductOptionGroupAdminEntityResolver,
    ProductOptionGroupEntityResolver,
} from './resolvers/entity/product-option-group-entity.resolver';
import {
    ProductVariantAdminEntityResolver,
    ProductVariantEntityResolver,
} from './resolvers/entity/product-variant-entity.resolver';
import { RefundEntityResolver } from './resolvers/entity/refund-entity.resolver';
import { RefundLineEntityResolver } from './resolvers/entity/refund-line-entity.resolver';
import { RoleEntityResolver } from './resolvers/entity/role-entity.resolver';
import { ShippingLineEntityResolver } from './resolvers/entity/shipping-line-entity.resolver';
import { ShippingMethodEntityResolver } from './resolvers/entity/shipping-method-entity.resolver';
import { TaxRateEntityResolver } from './resolvers/entity/tax-rate-entity.resolver';
import { UserEntityResolver } from './resolvers/entity/user-entity.resolver';
import { ZoneEntityResolver } from './resolvers/entity/zone-entity.resolver';
import { ShopAuthResolver } from './resolvers/shop/shop-auth.resolver';
import { ShopCustomerResolver } from './resolvers/shop/shop-customer.resolver';
import { ShopEnvironmentResolver } from './resolvers/shop/shop-environment.resolver';
import { ShopOrderResolver } from './resolvers/shop/shop-order.resolver';
import { ShopPaymentMethodsResolver } from './resolvers/shop/shop-payment-methods.resolver';
import { ShopProductsResolver } from './resolvers/shop/shop-products.resolver';
import { ShopShippingMethodsResolver } from './resolvers/shop/shop-shipping-methods.resolver';

const adminResolvers = [
    AdministratorResolver,
    ApiKeyResolver,
    AssetResolver,
    AuthResolver,
    ChannelResolver,
    CollectionResolver,
    CountryResolver,
    CustomerGroupResolver,
    CustomerResolver,
    DraftOrderResolver,
    DuplicateEntityResolver,
    FacetResolver,
    GlobalSettingsResolver,
    ImportResolver,
    JobResolver,
    SettingsStoreAdminResolver,
    OrderResolver,
    PaymentMethodResolver,
    ProductOptionResolver,
    ProductResolver,
    PromotionResolver,
    RoleResolver,
    SearchResolver,
    ScheduledTaskResolver,
    ShippingMethodResolver,
    SlugResolver,
    StockLocationResolver,
    TagResolver,
    TaxCategoryResolver,
    TaxRateResolver,
    SellerResolver,
    ZoneResolver,
];

const shopResolvers = [
    ShopAuthResolver,
    ShopCustomerResolver,
    ShopOrderResolver,
    ShopProductsResolver,
    ShopEnvironmentResolver,
    ShopPaymentMethodsResolver,
    ShopShippingMethodsResolver,
];

export const entityResolvers = [
    AssetEntityResolver,
    ChannelEntityResolver,
    CollectionEntityResolver,
    CountryEntityResolver,
    CustomerEntityResolver,
    CustomerGroupEntityResolver,
    FacetEntityResolver,
    FacetValueEntityResolver,
    FulfillmentEntityResolver,
    FulfillmentLineEntityResolver,
    OrderEntityResolver,
    OrderLineEntityResolver,
    PaymentEntityResolver,
    ProductEntityResolver,
    ProductOptionEntityResolver,
    ProductOptionGroupEntityResolver,
    ProductVariantEntityResolver,
    RefundEntityResolver,
    RefundLineEntityResolver,
    RoleEntityResolver,
    ShippingLineEntityResolver,
    UserEntityResolver,
    TaxRateEntityResolver,
    ShippingMethodEntityResolver,
    ZoneEntityResolver,
];

export const adminEntityResolvers = [
    AdministratorEntityResolver,
    CustomerAdminEntityResolver,
    OrderAdminEntityResolver,
    PaymentMethodEntityResolver,
    FulfillmentAdminEntityResolver,
    PaymentAdminEntityResolver,
    ProductVariantAdminEntityResolver,
    ProductAdminEntityResolver,
    ProductOptionGroupAdminEntityResolver,
    JobEntityResolver,
];

/**
 * The internal module containing some shared providers used by more than
 * one API module.
 */
@Module({
    imports: [ConfigModule, ServiceModule, CacheModule, ConnectionModule.forRoot()],
    providers: [IdCodecService, ConfigurableOperationCodec, CustomFieldRelationResolverService],
    exports: [
        IdCodecService,
        CacheModule,
        ConfigModule,
        ConfigurableOperationCodec,
        CustomFieldRelationResolverService,
        ServiceModule,
        ConnectionModule.forRoot(),
    ],
})
export class ApiSharedModule {}

/**
 * The internal module containing the Admin GraphQL API resolvers
 */
@Module({
    imports: [
        ApiSharedModule,
        JobQueueModule,
        SchedulerModule,
        DataImportModule,
        ...createDynamicGraphQlModulesForPlugins('admin'),
    ],
    providers: [...adminResolvers, ...entityResolvers, ...adminEntityResolvers],
    exports: [...adminResolvers],
})
export class AdminApiModule {}

/**
 * The internal module containing the Shop GraphQL API resolvers
 */
@Module({
    imports: [ApiSharedModule, ...createDynamicGraphQlModulesForPlugins('shop')],
    providers: [...shopResolvers, ...entityResolvers],
    exports: [...shopResolvers],
})
export class ShopApiModule {}
