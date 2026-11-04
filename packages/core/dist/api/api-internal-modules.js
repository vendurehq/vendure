"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShopApiModule = exports.AdminApiModule = exports.ApiSharedModule = exports.adminEntityResolvers = exports.entityResolvers = void 0;
const common_1 = require("@nestjs/common");
const cache_module_1 = require("../cache/cache.module");
const config_module_1 = require("../config/config.module");
const connection_module_1 = require("../connection/connection.module");
const data_import_module_1 = require("../data-import/data-import.module");
const job_queue_module_1 = require("../job-queue/job-queue.module");
const dynamic_plugin_api_module_1 = require("../plugin/dynamic-plugin-api.module");
const scheduler_module_1 = require("../scheduler/scheduler.module");
const service_module_1 = require("../service/service.module");
const configurable_operation_codec_1 = require("./common/configurable-operation-codec");
const custom_field_relation_resolver_service_1 = require("./common/custom-field-relation-resolver.service");
const id_codec_service_1 = require("./common/id-codec.service");
const administrator_resolver_1 = require("./resolvers/admin/administrator.resolver");
const api_key_resolver_1 = require("./resolvers/admin/api-key.resolver");
const asset_resolver_1 = require("./resolvers/admin/asset.resolver");
const auth_resolver_1 = require("./resolvers/admin/auth.resolver");
const channel_resolver_1 = require("./resolvers/admin/channel.resolver");
const collection_resolver_1 = require("./resolvers/admin/collection.resolver");
const country_resolver_1 = require("./resolvers/admin/country.resolver");
const customer_group_resolver_1 = require("./resolvers/admin/customer-group.resolver");
const customer_resolver_1 = require("./resolvers/admin/customer.resolver");
const draft_order_resolver_1 = require("./resolvers/admin/draft-order.resolver");
const duplicate_entity_resolver_1 = require("./resolvers/admin/duplicate-entity.resolver");
const facet_resolver_1 = require("./resolvers/admin/facet.resolver");
const global_settings_resolver_1 = require("./resolvers/admin/global-settings.resolver");
const import_resolver_1 = require("./resolvers/admin/import.resolver");
const job_resolver_1 = require("./resolvers/admin/job.resolver");
const order_resolver_1 = require("./resolvers/admin/order.resolver");
const payment_method_resolver_1 = require("./resolvers/admin/payment-method.resolver");
const product_option_resolver_1 = require("./resolvers/admin/product-option.resolver");
const product_resolver_1 = require("./resolvers/admin/product.resolver");
const promotion_resolver_1 = require("./resolvers/admin/promotion.resolver");
const province_resolver_1 = require("./resolvers/admin/province.resolver");
const role_resolver_1 = require("./resolvers/admin/role.resolver");
const scheduled_task_resolver_1 = require("./resolvers/admin/scheduled-task.resolver");
const search_resolver_1 = require("./resolvers/admin/search.resolver");
const seller_resolver_1 = require("./resolvers/admin/seller.resolver");
const settings_store_resolver_1 = require("./resolvers/admin/settings-store.resolver");
const shipping_method_resolver_1 = require("./resolvers/admin/shipping-method.resolver");
const slug_resolver_1 = require("./resolvers/admin/slug.resolver");
const stock_location_resolver_1 = require("./resolvers/admin/stock-location.resolver");
const tag_resolver_1 = require("./resolvers/admin/tag.resolver");
const tax_category_resolver_1 = require("./resolvers/admin/tax-category.resolver");
const tax_rate_resolver_1 = require("./resolvers/admin/tax-rate.resolver");
const zone_resolver_1 = require("./resolvers/admin/zone.resolver");
const administrator_entity_resolver_1 = require("./resolvers/entity/administrator-entity.resolver");
const asset_entity_resolver_1 = require("./resolvers/entity/asset-entity.resolver");
const channel_entity_resolver_1 = require("./resolvers/entity/channel-entity.resolver");
const collection_entity_resolver_1 = require("./resolvers/entity/collection-entity.resolver");
const country_entity_resolver_1 = require("./resolvers/entity/country-entity.resolver");
const customer_entity_resolver_1 = require("./resolvers/entity/customer-entity.resolver");
const customer_group_entity_resolver_1 = require("./resolvers/entity/customer-group-entity.resolver");
const facet_entity_resolver_1 = require("./resolvers/entity/facet-entity.resolver");
const facet_value_entity_resolver_1 = require("./resolvers/entity/facet-value-entity.resolver");
const fulfillment_entity_resolver_1 = require("./resolvers/entity/fulfillment-entity.resolver");
const fulfillment_line_entity_resolver_1 = require("./resolvers/entity/fulfillment-line-entity.resolver");
const job_entity_resolver_1 = require("./resolvers/entity/job-entity.resolver");
const order_entity_resolver_1 = require("./resolvers/entity/order-entity.resolver");
const order_line_entity_resolver_1 = require("./resolvers/entity/order-line-entity.resolver");
const payment_entity_resolver_1 = require("./resolvers/entity/payment-entity.resolver");
const payment_method_entity_resolver_1 = require("./resolvers/entity/payment-method-entity.resolver");
const product_entity_resolver_1 = require("./resolvers/entity/product-entity.resolver");
const product_option_entity_resolver_1 = require("./resolvers/entity/product-option-entity.resolver");
const product_option_group_entity_resolver_1 = require("./resolvers/entity/product-option-group-entity.resolver");
const product_variant_entity_resolver_1 = require("./resolvers/entity/product-variant-entity.resolver");
const refund_entity_resolver_1 = require("./resolvers/entity/refund-entity.resolver");
const refund_line_entity_resolver_1 = require("./resolvers/entity/refund-line-entity.resolver");
const role_entity_resolver_1 = require("./resolvers/entity/role-entity.resolver");
const shipping_line_entity_resolver_1 = require("./resolvers/entity/shipping-line-entity.resolver");
const shipping_method_entity_resolver_1 = require("./resolvers/entity/shipping-method-entity.resolver");
const tax_rate_entity_resolver_1 = require("./resolvers/entity/tax-rate-entity.resolver");
const user_entity_resolver_1 = require("./resolvers/entity/user-entity.resolver");
const zone_entity_resolver_1 = require("./resolvers/entity/zone-entity.resolver");
const shop_auth_resolver_1 = require("./resolvers/shop/shop-auth.resolver");
const shop_customer_resolver_1 = require("./resolvers/shop/shop-customer.resolver");
const shop_environment_resolver_1 = require("./resolvers/shop/shop-environment.resolver");
const shop_order_resolver_1 = require("./resolvers/shop/shop-order.resolver");
const shop_payment_methods_resolver_1 = require("./resolvers/shop/shop-payment-methods.resolver");
const shop_products_resolver_1 = require("./resolvers/shop/shop-products.resolver");
const shop_shipping_methods_resolver_1 = require("./resolvers/shop/shop-shipping-methods.resolver");
const adminResolvers = [
    administrator_resolver_1.AdministratorResolver,
    api_key_resolver_1.ApiKeyResolver,
    asset_resolver_1.AssetResolver,
    auth_resolver_1.AuthResolver,
    channel_resolver_1.ChannelResolver,
    collection_resolver_1.CollectionResolver,
    country_resolver_1.CountryResolver,
    customer_group_resolver_1.CustomerGroupResolver,
    customer_resolver_1.CustomerResolver,
    draft_order_resolver_1.DraftOrderResolver,
    duplicate_entity_resolver_1.DuplicateEntityResolver,
    facet_resolver_1.FacetResolver,
    global_settings_resolver_1.GlobalSettingsResolver,
    import_resolver_1.ImportResolver,
    job_resolver_1.JobResolver,
    settings_store_resolver_1.SettingsStoreAdminResolver,
    order_resolver_1.OrderResolver,
    payment_method_resolver_1.PaymentMethodResolver,
    product_option_resolver_1.ProductOptionResolver,
    product_resolver_1.ProductResolver,
    promotion_resolver_1.PromotionResolver,
    province_resolver_1.ProvinceResolver,
    role_resolver_1.RoleResolver,
    search_resolver_1.SearchResolver,
    scheduled_task_resolver_1.ScheduledTaskResolver,
    shipping_method_resolver_1.ShippingMethodResolver,
    slug_resolver_1.SlugResolver,
    stock_location_resolver_1.StockLocationResolver,
    tag_resolver_1.TagResolver,
    tax_category_resolver_1.TaxCategoryResolver,
    tax_rate_resolver_1.TaxRateResolver,
    seller_resolver_1.SellerResolver,
    zone_resolver_1.ZoneResolver,
];
const shopResolvers = [
    shop_auth_resolver_1.ShopAuthResolver,
    shop_customer_resolver_1.ShopCustomerResolver,
    shop_order_resolver_1.ShopOrderResolver,
    shop_products_resolver_1.ShopProductsResolver,
    shop_environment_resolver_1.ShopEnvironmentResolver,
    shop_payment_methods_resolver_1.ShopPaymentMethodsResolver,
    shop_shipping_methods_resolver_1.ShopShippingMethodsResolver,
];
exports.entityResolvers = [
    asset_entity_resolver_1.AssetEntityResolver,
    channel_entity_resolver_1.ChannelEntityResolver,
    collection_entity_resolver_1.CollectionEntityResolver,
    country_entity_resolver_1.CountryEntityResolver,
    customer_entity_resolver_1.CustomerEntityResolver,
    customer_group_entity_resolver_1.CustomerGroupEntityResolver,
    facet_entity_resolver_1.FacetEntityResolver,
    facet_value_entity_resolver_1.FacetValueEntityResolver,
    fulfillment_entity_resolver_1.FulfillmentEntityResolver,
    fulfillment_line_entity_resolver_1.FulfillmentLineEntityResolver,
    order_entity_resolver_1.OrderEntityResolver,
    order_line_entity_resolver_1.OrderLineEntityResolver,
    payment_entity_resolver_1.PaymentEntityResolver,
    product_entity_resolver_1.ProductEntityResolver,
    product_option_entity_resolver_1.ProductOptionEntityResolver,
    product_option_group_entity_resolver_1.ProductOptionGroupEntityResolver,
    product_variant_entity_resolver_1.ProductVariantEntityResolver,
    refund_entity_resolver_1.RefundEntityResolver,
    refund_line_entity_resolver_1.RefundLineEntityResolver,
    role_entity_resolver_1.RoleEntityResolver,
    shipping_line_entity_resolver_1.ShippingLineEntityResolver,
    user_entity_resolver_1.UserEntityResolver,
    tax_rate_entity_resolver_1.TaxRateEntityResolver,
    shipping_method_entity_resolver_1.ShippingMethodEntityResolver,
    zone_entity_resolver_1.ZoneEntityResolver,
];
exports.adminEntityResolvers = [
    administrator_entity_resolver_1.AdministratorEntityResolver,
    customer_entity_resolver_1.CustomerAdminEntityResolver,
    order_entity_resolver_1.OrderAdminEntityResolver,
    payment_method_entity_resolver_1.PaymentMethodEntityResolver,
    fulfillment_entity_resolver_1.FulfillmentAdminEntityResolver,
    payment_entity_resolver_1.PaymentAdminEntityResolver,
    product_variant_entity_resolver_1.ProductVariantAdminEntityResolver,
    product_entity_resolver_1.ProductAdminEntityResolver,
    product_option_group_entity_resolver_1.ProductOptionGroupAdminEntityResolver,
    job_entity_resolver_1.JobEntityResolver,
];
/**
 * The internal module containing some shared providers used by more than
 * one API module.
 */
let ApiSharedModule = class ApiSharedModule {
};
exports.ApiSharedModule = ApiSharedModule;
exports.ApiSharedModule = ApiSharedModule = __decorate([
    (0, common_1.Module)({
        imports: [config_module_1.ConfigModule, service_module_1.ServiceModule, cache_module_1.CacheModule, connection_module_1.ConnectionModule.forRoot()],
        providers: [id_codec_service_1.IdCodecService, configurable_operation_codec_1.ConfigurableOperationCodec, custom_field_relation_resolver_service_1.CustomFieldRelationResolverService],
        exports: [
            id_codec_service_1.IdCodecService,
            cache_module_1.CacheModule,
            config_module_1.ConfigModule,
            configurable_operation_codec_1.ConfigurableOperationCodec,
            custom_field_relation_resolver_service_1.CustomFieldRelationResolverService,
            service_module_1.ServiceModule,
            connection_module_1.ConnectionModule.forRoot(),
        ],
    })
], ApiSharedModule);
/**
 * The internal module containing the Admin GraphQL API resolvers
 */
let AdminApiModule = class AdminApiModule {
};
exports.AdminApiModule = AdminApiModule;
exports.AdminApiModule = AdminApiModule = __decorate([
    (0, common_1.Module)({
        imports: [
            ApiSharedModule,
            job_queue_module_1.JobQueueModule,
            scheduler_module_1.SchedulerModule,
            data_import_module_1.DataImportModule,
            ...(0, dynamic_plugin_api_module_1.createDynamicGraphQlModulesForPlugins)('admin'),
        ],
        providers: [...adminResolvers, ...exports.entityResolvers, ...exports.adminEntityResolvers],
        exports: [...adminResolvers],
    })
], AdminApiModule);
/**
 * The internal module containing the Shop GraphQL API resolvers
 */
let ShopApiModule = class ShopApiModule {
};
exports.ShopApiModule = ShopApiModule;
exports.ShopApiModule = ShopApiModule = __decorate([
    (0, common_1.Module)({
        imports: [ApiSharedModule, ...(0, dynamic_plugin_api_module_1.createDynamicGraphQlModulesForPlugins)('shop')],
        providers: [...shopResolvers, ...exports.entityResolvers],
        exports: [...shopResolvers],
    })
], ShopApiModule);
//# sourceMappingURL=api-internal-modules.js.map