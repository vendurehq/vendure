import { Inject, MiddlewareConsumer, NestModule, OnApplicationBootstrap, Type } from '@nestjs/common';
import { I18nService, Injector, LanguageCode, Logger, PluginCommonModule, RequestContext, VendurePlugin, ChannelService } from '@vendure/core';
import { APP_GUARD, ModuleRef } from '@nestjs/core';

import { CJK_PLUGIN_OPTIONS, loggerCtx } from './constants';
import { codPaymentHandler } from './payment/cod-handler';
import { aggregatePaymentHandler } from './payment/aggregate-payment-handler';
import { fixedAggregateCollectionHandler } from './payment/fixed-aggregate-collection-handler';
import { couponStackableCondition } from './promotion/coupon-stackable-condition';
import { promotionCustomFields } from './promotion/promotion-custom-fields';
import {
    storePickupCalculator,
    pickupPointCalculator,
    employeePickupCalculator,
    localDeliveryCalculator,
} from './pickup/pickup-calculator';
import {
    storePickupEligibilityChecker,
    pickupPointEligibilityChecker,
    employeePickupEligibilityChecker,
} from './pickup/pickup-eligibility-checker';
import {
    storePickupFulfillmentHandler,
    pickupPointFulfillmentHandler,
    employeePickupFulfillmentHandler,
} from './pickup/pickup-fulfillment-handler';
import { PickupLocation } from './pickup/pickup-location.entity';
import { PickupLocationAdminResolver } from './pickup/pickup-location-admin.resolver';
import { PickupLocationShopResolver } from './pickup/pickup-location-shop.resolver';
import { PickupShopResolver } from './pickup/pickup-shop.resolver';
import { PickupLocationService } from './pickup/pickup-location.service';
import { pickupPermissionDefinitions } from './pickup/pickup-permissions';
import { pickupLocationPermissionDefinitions } from './pickup/pickup-location-permissions';
import { EmployeeCustomer } from './pickup/enterprise-customer/enterprise-customer.entity';
import { EmployeeCustomerService } from './pickup/enterprise-customer/enterprise-customer.service';
import { EmployeeCustomerAdminResolver } from './pickup/enterprise-customer/enterprise-customer-admin.resolver';
import { orderCustomFields } from './order/order-custom-fields';
import { orderPriceChannelCustomFields } from './order/order-price-custom-fields';
import { OrderPriceAdminResolver } from './order/order-price-admin.resolver';
import { MyOrdersShopResolver } from './order/my-orders-shop.resolver';
import { customerCustomFields } from './customer/customer-custom-fields';
import { tenantChannelCustomFields } from './tenant/tenant-channel-custom-fields';
import { productTypeCustomFields } from './product/product-custom-fields';
import { productVariantCustomFields } from './shipping/product-variant-custom-fields';
import { customShippingMethodFields } from './shipping/shipping-method-custom-fields';
import { assetCustomFields } from './asset/asset-custom-fields';
import { AssetLibraryAdminResolver } from './asset/asset-library-admin.resolver';
import { CustomerAssetShopResolver } from './asset/customer-asset-shop.resolver';
import { tieredWeightShippingCalculator, tieredQuantityShippingCalculator } from './shipping/tiered-shipping-calculator';
import { tieredShippingEligibilityChecker } from './shipping/tiered-shipping-eligibility-checker';
import { ShippingTemplate } from './shipping/shipping-template.entity';
import { ShippingTemplateService } from './shipping/shipping-template.service';
import { ShippingTemplateAdminResolver } from './shipping/shipping-template-admin.resolver';
import { shippingTemplatePermissionDefinitions } from './shipping/shipping-template-permissions';
import { TenantSetupService } from './tenant/tenant-setup.service';
import { TenantMember } from './tenant/tenant-member.entity';
import { tenantPermissionDefinitions } from './tenant/tenant-permissions';
import { TenantMemberService } from './tenant/tenant-member.service';
import { RedeemScopeService } from './tenant/redeem-scope.service';
import { TenantAdminResolver } from './tenant/tenant-admin.resolver';
import { TenantMemberResolver } from './tenant/tenant-member.resolver';
import { MyAccessResolver } from './tenant/my-access.resolver';
import { CjkPluginOptions } from './types';
import { AuthShopResolver } from './auth/auth-shop.resolver';
import { AuthAdminResolver } from './auth/auth-admin.resolver';
import { AuthMethodGuard } from './auth/auth-method-guard';
import { TenantEnabledGuard } from './auth/tenant-enabled.guard';
import { ssoAuthenticationStrategy } from './auth/sso-authentication-strategy';
import { setAuthSecret } from './auth/crypto';
import { DomainResolverService } from './tenant/domain-resolver.service';
import { DomainShopResolver } from './tenant/domain-shop.resolver';
import { MapProviderRegistry } from './map/map-provider-registry';
import { MapService } from './map/map.service';
import { MapAdminResolver } from './map/map-admin.resolver';
import { MapShopResolver } from './map/map-shop.resolver';
import { MapConfigEncryptionMigration, PayConfigEncryptionMigration, TenantMemberColumnMigration, AddTenantMemberRedeemProfiles, ChannelCustomColumnMigration, ShippingContactFlagMigration, StockTableMigration, ChannelInventoryModeColumnMigration, CollectionIconMigration, ReservationExpiresAtMigration, ReservationTtlColumnMigration, PickBatchHandoverColumnMigration, StocktakePostedDocIndexMigration, HotelOrderLineColumnMigration, HotelBookingCancelColumnsMigration, HotelBookingRescheduleColumnsMigration, PaymentProfileMethodTableMigration, PickupStoreLinkSoftDeleteMigration, PickupPermissionsRoleGrantMigration } from './migrations';
import { setRedeemScopeResolver } from '@vendure/coupon-plugin';
import { AuthConfigService } from './auth/auth-config.service';
import { PayConfigService } from './payment/pay-config.service';
import { MapConfigService } from './map/map-config.service';
import { SsoProviderService } from './auth/sso-provider.service';
import { InviteCodeService } from './auth/invite-code.service';
import { BasicConfigService } from './tenant/basic-config.service';
import { ChannelProvisioningService } from './tenant/channel-provisioning.service';
import { ServiceNotifyConfigService } from './tenant/service-notify-config.service';
import { MultiLanguageConfigService } from './tenant/multi-language-config.service';
import { tenantConfigPermission } from './admin/tenant-config-permissions';
import { TenantConfigAdminResolver } from './admin/tenant-config-admin.resolver';
import { ShippingProfile } from './shipping/shipping-profile.entity';
import { ShippingProfileMethod } from './shipping/shipping-profile-method.entity';
import { ShippingProfileService } from './shipping/shipping-profile.service';
import { DeliveryFacetService } from './shipping/delivery-facet.service';
import { ShippingProfileAdminResolver } from './shipping/shipping-profile-admin.resolver';
import { shippingProfilePermission, shippingProfilePermissionDefinitions } from './shipping/shipping-profile-permissions';
import { PaymentProfile } from './payment/payment-profile.entity';
import { PaymentProfileMethod } from './payment/payment-profile-method.entity';
import { PaymentProfileService } from './payment/payment-profile.service';
import { PaymentProfileAdminResolver } from './payment/payment-profile-admin.resolver';
import { paymentProfilePermission, paymentProfilePermissionDefinitions } from './payment/payment-profile-permissions';
import { PaymentTemplate } from './payment/payment-template.entity';
import { PaymentTemplateService } from './payment/payment-template.service';
import { PaymentTemplateAdminResolver } from './payment/payment-template-admin.resolver';
import { paymentTemplatePermissionDefinitions } from './payment/payment-template-permissions';
import { RoomTemplate } from './hotel/room-template.entity';
import { RoomTemplateControl } from './hotel/room-template-control.entity';
import { RoomTemplateService } from './hotel/room-template.service';
import { RoomTemplateAdminResolver } from './hotel/room-template-admin.resolver';
import { HotelRoomDay } from './hotel/booking/room-day.entity';
import { HotelBookingLock } from './hotel/booking/booking-lock.entity';
import { HotelRatePlan } from './hotel/booking/rate-plan.entity';
import { HotelBooking } from './hotel/booking/booking.entity';
import { HotelInventoryService } from './hotel/booking/hotel-inventory.service';
import { HotelRatePlanService } from './hotel/booking/rate-plan.service';
import { HotelBookingService } from './hotel/booking/booking.service';
import { HotelOrderInterceptor } from './hotel/booking/hotel-order-interceptor';
import { releaseExpiredHotelHoldsTask, RELEASE_EXPIRED_HOTEL_HOLDS_TASK_ID } from './hotel/booking/release-expired-holds.task';
import { hotelBookingDailyTransitionTask, HOTEL_BOOKING_DAILY_TRANSITION_TASK_ID } from './hotel/booking/booking-daily-transition.task';
import { hotelRoomCustomFields } from './hotel/hotel-custom-fields';
import { hotelOrderLineCustomFields } from './hotel/hotel-order-line-custom-fields';
import { HotelOrderItemPriceCalculationStrategy } from './hotel/hotel-order-item-price-strategy';
import { ShippingProfileShopResolver } from './shipping/shipping-profile-shop.resolver';
import { DeliveryCapabilityResolver } from './shipping/delivery-capability.resolver';
import { PaymentProfileShopResolver } from './payment/payment-profile-shop.resolver';
import { OrderBoxService } from './order/order-box.service';
import { OrderBoxShopResolver } from './order/order-box-shop.resolver';
import { OrderSplitService } from './order/order-split.service';
import { OrderSplitShopResolver } from './order/order-split-shop.resolver';
import {
    MerchantSettlementLedger,
} from './order/merchant-settlement-ledger.entity';
import { MerchantSettlementService } from './order/merchant-settlement.service';
import { MerchantSettlementAdminResolver } from './order/merchant-settlement-admin.resolver';
import { RedemptionCodeService } from './redemption/redemption-code.service';
import { OrderScopeService } from './order-scope/order-scope.service';
import { OrderScopeAdminResolver } from './order-scope/order-scope.resolver';
import { RedemptionShopResolver, RedemptionAdminResolver } from './redemption/redemption.resolver';
import { redemptionShopSchema, redemptionAdminSchema } from './redemption/redemption.schema';
import { HotelInventoryShopResolver } from './hotel/booking/hotel-inventory-shop.resolver';
import { HotelInventoryAdminResolver } from './hotel/booking/hotel-inventory-admin.resolver';
import { HotelRatePlanAdminResolver } from './hotel/booking/rate-plan-admin.resolver';
import { HotelRatePlanShopResolver } from './hotel/booking/rate-plan-shop.resolver';
import { HotelBookingAdminResolver } from './hotel/booking/booking-admin.resolver';
import { HotelBookingShopResolver } from './hotel/booking/booking-shop.resolver';
import { BoxShippingLineAssignmentStrategy } from './shipping/box-shipping-line-assignment-strategy';
import { ChannelTaxLineCalculationStrategy } from './tax/channel-tax-line-calculation-strategy';
import { ChannelEvent, EventBus, OrderEvent, OrderService, OrderStateTransitionEvent, PaymentStateTransitionEvent, TransactionalConnection } from '@vendure/core';
import { AfterSalesService, AfterSalesStateTransitionEvent } from '@vendure/after-sales-plugin';
import { DefaultDataService } from './seed/default-data.service';
import { Wallet } from './wallet/wallet.entity';
import { WalletService } from './wallet/wallet.service';
import { WalletAdminResolver } from './wallet/wallet-admin.resolver';
import { WalletShopResolver } from './wallet/wallet-shop.resolver';
import { balanceWalletPaymentHandler, setWalletService } from './wallet/balance-wallet-payment-handler';
import { TenantCatalogService } from './tenant/tenant-catalog.service';
import { TenantCatalogAdminResolver } from './tenant/tenant-catalog-admin.resolver';
import { TenantOptionGroupService } from './tenant/tenant-option-group.service';
import { stockLocationCustomFields } from './inventory/stock-location-custom-fields';
import { VariantLocationBinding } from './inventory/variant-location-binding.entity';
import { VariantLocationBindingService } from './inventory/variant-location-binding.service';
import { VirtualPhysicalStockService } from './inventory/virtual-physical-stock.service';
import { InventoryShopResolver } from './inventory/inventory-shop.resolver';
import { InventoryService, StockLedgerService } from '@vendure/inventory-plugin';
import { DeliveryRecordService } from './delivery/delivery-record.service';
import { DeliveryRecord } from './delivery/delivery-record.entity';
import { DeliveryAdminResolver } from './delivery/delivery-admin.resolver';
import { InventoryAdminResolver } from './inventory/inventory-admin.resolver';
import { ReconciliationBatch, ReconciliationOrderLine } from './reconcile/reconciliation.entity';
import { ReconciliationService } from './reconcile/reconciliation.service';
import { ReconciliationAdminResolver } from './reconcile/reconciliation-admin.resolver';
import { StockDocEntity } from './inventory/stock-doc.entity';
import { StockDocItemEntity } from './inventory/stock-doc-item.entity';
import { StockDocService } from './inventory/stock-doc.service';
import { StockDocAdminResolver } from './inventory/stock-doc.admin.resolver';
import { StockReservationAdminResolver } from './inventory/stock-reservation.admin.resolver';
import { StockReservationEntity } from './inventory/stock-reservation.entity';
import { StockReservationItemEntity } from './inventory/stock-reservation-item.entity';
import { StockReservationService } from './inventory/stock-reservation.service';
import { releaseExpiredReservationsTask, RELEASE_EXPIRED_RESERVATIONS_TASK_ID } from './inventory/reservation-expiry.task';
import { InventoryModeService } from './inventory/inventory-mode.service';
import { InventoryAlertRuleEntity } from './inventory/inventory-alert-rule.entity';
import { InventoryAlertRuleService } from './inventory/inventory-alert-rule.service';
import { InventoryStockService } from './inventory/inventory-stock.service';
import { SimpleInventoryAdapter } from './inventory/simple-inventory.adapter';
import { OdooInventoryAdapter } from './inventory/odoo-inventory.adapter';
import { inventoryModeChannelFields } from './inventory/inventory-mode.custom-fields';
import { PickBatch } from './picking/pick-batch.entity';
import { PickBatchOrder } from './picking/pick-batch-order.entity';
import { PickBatchService } from './picking/pick-batch.service';
import { PickBatchAdminResolver } from './picking/pick-batch.admin.resolver';
import { StorageZone } from './storage/storage-zone.entity';
import { StorageBin } from './storage/storage-bin.entity';
import { VariantStorageBin } from './storage/variant-storage-bin.entity';
import { StorageBinService } from './storage/storage-bin.service';
import { StorageBinAdminResolver } from './storage/storage-bin.admin.resolver';
import { StorageBinShopResolver } from './storage/storage-bin.shop.resolver';
import { OrderAddressAdminResolver } from './order/order-address.admin.resolver';
import { StocktakeTask } from './stocktake/stocktake-task.entity';
import { StocktakeWave } from './stocktake/stocktake-wave.entity';
import { StocktakeLine } from './stocktake/stocktake-line.entity';
import { StocktakeService } from './stocktake/stocktake.service';
import { StocktakeAdminResolver } from './stocktake/stocktake.admin.resolver';
import { stocktakePermissionDefinitions } from './stocktake/stocktake-permissions';

/** 幂等合并自定义字段（plugin configuration 可能被调用多次，按 name 去重） */
function mergeCustomFields<T extends { name: string }>(
    existingFields: T[] | undefined,
    additions: T[] | undefined,
): T[] {
    const names = new Set((existingFields ?? []).map(f => f.name));
    return [...(existingFields ?? []), ...(additions ?? []).filter(f => !names.has(f.name))];
}

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [PickupLocation, EmployeeCustomer, ShippingTemplate, ShippingProfile, PaymentProfile, ShippingProfileMethod, PaymentProfileMethod, PaymentTemplate, RoomTemplate, RoomTemplateControl, HotelRoomDay, HotelBookingLock, HotelRatePlan, HotelBooking, TenantMember, Wallet, MerchantSettlementLedger, VariantLocationBinding, DeliveryRecord, ReconciliationBatch, ReconciliationOrderLine, StockDocEntity, StockDocItemEntity, InventoryAlertRuleEntity, StockReservationEntity, StockReservationItemEntity, PickBatch, PickBatchOrder, StorageZone, StorageBin, VariantStorageBin,
        StocktakeTask,
        StocktakeWave,
        StocktakeLine,
    ],
    providers: [
        { provide: CJK_PLUGIN_OPTIONS, useFactory: () => CjkPlugin.options },
        TenantSetupService,
        PickupLocationService,
        EmployeeCustomerService,
        DomainResolverService,
        MapProviderRegistry,
        MapService,
        { provide: APP_GUARD, useClass: AuthMethodGuard },
        { provide: APP_GUARD, useClass: TenantEnabledGuard },
        MapConfigEncryptionMigration,
        PayConfigEncryptionMigration,
        TenantMemberColumnMigration,
        AddTenantMemberRedeemProfiles,
        ChannelCustomColumnMigration,
        ReservationExpiresAtMigration,
        ReservationTtlColumnMigration,
        PickBatchHandoverColumnMigration,
        StocktakePostedDocIndexMigration,
        ShippingContactFlagMigration,
        StockTableMigration,
        ChannelInventoryModeColumnMigration,
        CollectionIconMigration,
        HotelOrderLineColumnMigration,
        HotelBookingCancelColumnsMigration,
        HotelBookingRescheduleColumnsMigration,
        PaymentProfileMethodTableMigration,
        PickupStoreLinkSoftDeleteMigration,
        PickupPermissionsRoleGrantMigration,
        AuthConfigService,
        PayConfigService,
        MapConfigService,
        SsoProviderService,
        InviteCodeService,
        BasicConfigService,
        ChannelProvisioningService,
        ServiceNotifyConfigService,
        MultiLanguageConfigService,
        ShippingTemplateService,
        ShippingProfileService,
        DeliveryFacetService,
        PaymentProfileService,
        PaymentTemplateService,
        RoomTemplateService,
        HotelInventoryService,
        HotelRatePlanService,
        HotelBookingService,
        DefaultDataService,
        TenantMemberService,
        RedeemScopeService,
        OrderBoxService,
        OrderSplitService,
        MerchantSettlementService,
        WalletService,
        TenantCatalogService,
        TenantOptionGroupService,
        RedemptionCodeService,
        OrderScopeService,
        VariantLocationBindingService,
        StockLedgerService,
        InventoryService,
        VirtualPhysicalStockService,
        StockDocService,
        StockReservationService,
        InventoryModeService,
        InventoryAlertRuleService,
        InventoryStockService,
        SimpleInventoryAdapter,
        OdooInventoryAdapter,
        DeliveryRecordService,
        ReconciliationService,
        PickBatchService,
        StorageBinService,
        StocktakeService,
    ],
    adminApiExtensions: {
        schema: () => {
            const { gql } = require('graphql-tag');
            return gql`
                enum PickupLocationType {
                    store
                    point
                    employee
                }

                type PickupLocation implements Node {
                    id: ID!
                    createdAt: DateTime!
                    updatedAt: DateTime!
                    name: String!
                    type: PickupLocationType!
                    address: String!
                    contactPerson: String
                    phoneNumber: String
                    businessHours: String
                    coordinates: JSON
                    partner: String
                    photos: JSON
                    remark: String
                    sortOrder: Int!
                    enabled: Boolean!
                    isPublic: Boolean!
                    ownerChannelId: ID
                    merchantStoreId: ID
                    province: String
                    city: String
                    district: String
                    street: String
                }

                type PickupLocationList implements PaginatedList {
                    items: [PickupLocation!]!
                    totalItems: Int!
                }

                input CreatePickupLocationInput {
                    name: String!
                    type: PickupLocationType!
                    address: String!
                    contactPerson: String
                    phoneNumber: String
                    businessHours: String
                    coordinates: JSON
                    partner: String
                    photos: JSON
                    remark: String
                    sortOrder: Int
                    enabled: Boolean
                    isPublic: Boolean
                    merchantStoreId: ID
                    province: String
                    city: String
                    district: String
                    street: String
                }

                input UpdatePickupLocationInput {
                    id: ID!
                    name: String
                    type: PickupLocationType
                    address: String
                    contactPerson: String
                    phoneNumber: String
                    businessHours: String
                    coordinates: JSON
                    partner: String
                    photos: JSON
                    remark: String
                    sortOrder: Int
                    enabled: Boolean
                    isPublic: Boolean
                    merchantStoreId: ID
                    province: String
                    city: String
                    district: String
                    street: String
                }

                input PickupLocationListOptions

                extend type Query {
                    pickupLocations(options: PickupLocationListOptions): PickupLocationList!
                    pickupLocation(id: ID!): PickupLocation
                }

                extend type Mutation {
                    createPickupLocation(input: CreatePickupLocationInput!): PickupLocation!
                    updatePickupLocation(input: UpdatePickupLocationInput!): PickupLocation!
                    deletePickupLocation(id: ID!): Boolean!
                    promotePickupLocationToPublic(id: ID!): PickupLocation!
                    assignPickupLocationsToChannel(ids: [ID!]!): Boolean!
                    removePickupLocationsFromChannel(ids: [ID!]!): Boolean!
                }

                type EmployeeCustomer implements Node {
                    id: ID!
                    customer: Customer!
                    enterpriseName: String!
                    employeeId: String
                    pickupLocations: [PickupLocation!]!
                    channel: Channel!
                    verified: Boolean!
                    createdAt: DateTime!
                }

                input CreateEmployeeCustomerInput {
                    customerId: ID!
                    enterpriseName: String!
                    employeeId: String
                    pickupLocationIds: [ID!]!
                    verified: Boolean
                }

                input UpdateEmployeeCustomerInput {
                    id: ID!
                    enterpriseName: String
                    employeeId: String
                    pickupLocationIds: [ID!]
                    verified: Boolean
                }

                extend type Query {
                    employeeCustomers: [EmployeeCustomer!]!
                    employeeCustomer(id: ID!): EmployeeCustomer
                    employeeCustomersByCustomer(customerId: ID!): [EmployeeCustomer!]!
                }

                extend type Mutation {
                    createEmployeeCustomer(input: CreateEmployeeCustomerInput!): EmployeeCustomer!
                    updateEmployeeCustomer(input: UpdateEmployeeCustomerInput!): EmployeeCustomer!
                    deleteEmployeeCustomer(id: ID!): Boolean!
                    bindEnterprisePickupLocations(id: ID!, pickupLocationIds: [ID!]!): EmployeeCustomer!
                    verifyEmployeeCustomer(id: ID!): EmployeeCustomer!
                }

                extend type Query {
                    channelAuthConfig(channelId: ID!): TenantAuthConfigMasked
                }

                extend type Mutation {
                    updateChannelAuthConfig(channelId: ID!, input: JSON!): TenantAuthConfigMasked!
                }

                type TenantAuthConfigMasked {
                    enabledMethods: [String!]!
                    overrides: JSON
                    ssoProviders: [SsoProviderMasked!]!
                }

                type SsoProviderMasked {
                    name: String!
                    providerKey: String!
                    protocol: String!
                    baseUrl: String!
                    authorizeUrl: String
                    tokenUrl: String
                    userInfoUrl: String
                    clientId: String!
                    clientSecret: String!
                    scopes: [String!]!
                    channelCode: String
                    userInfoMapping: JSON
                }

                type DistrictNode {
                    adcode: String!
                    name: String!
                    level: String!
                    center: LatLng!
                }

                type ReverseGeocodeResult {
                    province: String
                    city: String
                    district: String
                    street: String
                    formattedAddress: String!
                }

                type MapSdkConfig {
                    provider: String!
                    sdkUrl: String!
                    hasConfigured: Boolean!
                }

                type ChannelMapConfig {
                    provider: String!
                    apiKey: String!
                    hasConfigured: Boolean!
                }

                type LatLng {
                    lat: Float!
                    lng: Float!
                }

                extend type Query {
                    mapDistricts(parentAdcode: String): [DistrictNode!]!
                    reverseGeocode(lat: Float!, lng: Float!): ReverseGeocodeResult!
                    mapSdkConfig: MapSdkConfig!
                    channelMapConfig(channelId: ID!): ChannelMapConfig!
                }

                extend type Query {
                    tenantConfig(channelId: ID!): TenantConfigPayload!
                }

                extend type Mutation {
                    updateTenantConfig(input: UpdateTenantConfigInput!): TenantConfigPayload!
                    testSsoConnection(input: TestSsoInput!): TestSsoResult!
                }

                type TenantConfigPayload {
                    channelId: ID!
                    auth: JSON
                    pay: JSON
                    map: JSON
                    canEdit: Boolean!
                }

                input UpdateTenantConfigInput {
                    channelId: ID!
                    authPatch: JSON
                    payPatch: JSON
                    mapPatch: JSON
                }

                input TestSsoInput {
                    channelId: ID!
                    providerKey: String!
                    newClientSecret: String
                }

                type TestSsoResult {
                    success: Boolean!
                    latencyMs: Int!
                    error: String
                }

                extend type Query {
                    tenantSettings(channelId: ID!): TenantSettingsPayload!
                }

                type TenantSettingsPayload {
                    channelId: ID!
                    basic: JSON
                    auth: JSON
                    pay: JSON
                    map: JSON
                    serviceNotify: JSON
                    multiLanguage: JSON
                    canEdit: Boolean!
                }

                extend type Mutation {
                    updateTenantBasic(input: TenantSectionPatchInput!): TenantSettingsPayload!
                    updateTenantMultiLanguage(input: TenantSectionPatchInput!): TenantSettingsPayload!
                    updateTenantServiceNotify(input: TenantSectionPatchInput!): TenantSettingsPayload!
                }

                input TenantSectionPatchInput {
                    channelId: ID!
                    patch: JSON!
                }

                # ===== Shipping Template =====
                # checker/calculator 为 ConfigurableOperation 形态（code + arguments），
                # 与 Vendure 内置 ConfigArg（仅 name/value）不同，故定义独立只读类型
                type TemplateOperation {
                    code: String!
                    arguments: [ConfigArg!]!
                }

                type ShippingTemplate {
                    id: ID!
                    name: String!
                    description: String!
                    code: String!
                    fulfillmentHandler: String!
                    checker: TemplateOperation
                    calculator: TemplateOperation
                    isGlobal: Boolean!
                }

                type ShippingTemplateList {
                    items: [ShippingTemplate!]!
                    totalItems: Int!
                }

                input ShippingTemplateListOptions {
                    skip: Int
                    take: Int
                    sort: JSON
                    filter: JSON
                }

                # checker/calculator 入参形态与 TemplateOperation 一致：code + arguments
                input ShippingTemplateConfigInput {
                    code: String!
                    arguments: [ConfigArgInput!]!
                }

                input CreateShippingTemplateInput {
                    name: String!
                    description: String!
                    code: String!
                    fulfillmentHandler: String!
                    checker: ShippingTemplateConfigInput!
                    calculator: ShippingTemplateConfigInput!
                    isGlobal: Boolean
                }

                input UpdateShippingTemplateInput {
                    id: ID!
                    name: String
                    description: String
                    code: String
                    fulfillmentHandler: String
                    checker: ShippingTemplateConfigInput
                    calculator: ShippingTemplateConfigInput
                }

                extend type Query {
                    shippingTemplates(options: ShippingTemplateListOptions): ShippingTemplateList!
                    shippingTemplate(id: ID!): ShippingTemplate
                }

                extend type Mutation {
                    createShippingTemplate(input: CreateShippingTemplateInput!): ShippingTemplate!
                    updateShippingTemplate(input: UpdateShippingTemplateInput!): ShippingTemplate!
                    deleteShippingTemplate(id: ID!): Boolean!
                    createShippingMethodFromTemplate(templateId: ID!, name: String, code: String): ShippingMethod!
                    updateShippingMethodShippingPrice(id: ID!, shippingPrice: Int!): ShippingMethod!
                }

                # ===== Shipping Profile =====
                type ShippingProfile implements Node {
                    id: ID!
                    name: String!
                    # 可空：实体列与 Create/Update 输入均允许不填（历史数据存在 null）
                    description: String
                    code: String!
                    isGlobal: Boolean!
                    freeShippingThreshold: Int
                    shippingMethods: [ShippingMethod!]!
                    pickupLocations: [PickupLocation!]!
                    # 档案真实绑定的自提点（档案级 + 方式级，不受租户可见性过滤；管理端展示用）
                    boundPickupLocations: [PickupLocation!]!
                    isTenantDefault: Boolean!
                    enabled: Boolean!
                    requiresAddress: Boolean!
                    requiresContact: Boolean!
                    methodConfigs: [ShippingProfileMethodConfig!]!
                    paymentProfileId: ID
                }

                type ShippingProfileMethodConfig {
                    shippingMethodId: ID!
                    mode: String!
                    options: JSON
                }

                input ShippingProfileMethodConfigInput {
                    shippingMethodId: ID!
                    mode: String!
                    options: JSON
                }

                type ShippingProfileList implements PaginatedList {
                    items: [ShippingProfile!]!
                    totalItems: Int!
                }

                input CreateShippingProfileInput {
                    name: String!
                    code: String!
                    description: String
                    isGlobal: Boolean
                    enabled: Boolean
                    freeShippingThreshold: Int
                    requiresAddress: Boolean
                    requiresContact: Boolean
                    shippingMethodIds: [ID!]!
                    pickupLocationIds: [ID!]
                    methodConfigs: [ShippingProfileMethodConfigInput!]
                    paymentProfileId: ID
                }

                input UpdateShippingProfileInput {
                    id: ID!
                    name: String
                    code: String
                    description: String
                    isGlobal: Boolean
                    enabled: Boolean
                    freeShippingThreshold: Int
                    requiresAddress: Boolean
                    requiresContact: Boolean
                    shippingMethodIds: [ID!]
                    pickupLocationIds: [ID!]
                    methodConfigs: [ShippingProfileMethodConfigInput!]
                    paymentProfileId: ID
                }

                input ShippingProfileListOptions {
                    skip: Int
                    take: Int
                    sort: JSON
                    filter: JSON
                }

                extend type Query {
                    shippingProfiles(options: ShippingProfileListOptions): ShippingProfileList!
                    shippingProfile(id: ID!): ShippingProfile
                }

                extend type Mutation {
                    createShippingProfile(input: CreateShippingProfileInput!): ShippingProfile!
                    updateShippingProfile(input: UpdateShippingProfileInput!): ShippingProfile!
                    deleteShippingProfile(id: ID!): Boolean!
                    assignShippingProfile(variantIds: [ID!]!, profileId: ID!): Boolean!
                    setTenantDefaultShippingProfile(id: ID!): Boolean!
                }

                # ===== Payment Profile =====
                type PaymentProfile implements Node {
                    id: ID!
                    name: String!
                    description: String!
                    code: String!
                    isGlobal: Boolean!
                    installmentOptions: JSON
                    paymentMethods: [PaymentMethod!]!
                    isTenantDefault: Boolean!
                    enabled: Boolean!
                    methodConfigs: [PaymentProfileMethodConfig!]!
                }

                type PaymentProfileMethodConfig {
                    paymentMethodId: ID!
                    mode: String!
                    options: JSON
                }

                input PaymentProfileMethodConfigInput {
                    paymentMethodId: ID!
                    mode: String!
                    options: JSON
                }

                type PaymentProfileList implements PaginatedList {
                    items: [PaymentProfile!]!
                    totalItems: Int!
                }

                input CreatePaymentProfileInput {
                    name: String!
                    code: String!
                    description: String
                    isGlobal: Boolean
                    enabled: Boolean
                    installmentOptions: JSON
                    paymentMethodIds: [ID!]!
                    methodConfigs: [PaymentProfileMethodConfigInput!]
                }

                input UpdatePaymentProfileInput {
                    id: ID!
                    name: String
                    code: String
                    description: String
                    isGlobal: Boolean
                    enabled: Boolean
                    installmentOptions: JSON
                    paymentMethodIds: [ID!]
                    methodConfigs: [PaymentProfileMethodConfigInput!]
                }

                input PaymentProfileListOptions {
                    skip: Int
                    take: Int
                    sort: JSON
                    filter: JSON
                }

                extend type Query {
                    paymentProfiles(options: PaymentProfileListOptions): PaymentProfileList!
                    paymentProfile(id: ID!): PaymentProfile
                }

                extend type Mutation {
                    createPaymentProfile(input: CreatePaymentProfileInput!): PaymentProfile!
                    updatePaymentProfile(input: UpdatePaymentProfileInput!): PaymentProfile!
                    deletePaymentProfile(id: ID!): Boolean!
                    assignPaymentProfile(variantIds: [ID!]!, profileId: ID!): Boolean!
                    setTenantDefaultPaymentProfile(id: ID!): Boolean!
                }

                # ===== Payment Template =====
                type PaymentTemplate {
                    id: ID!
                    name: String!
                    description: String!
                    code: String!
                    handler: ConfigArg!
                    checker: ConfigArg
                    isGlobal: Boolean!
                }

                type PaymentTemplateList {
                    items: [PaymentTemplate!]!
                    totalItems: Int!
                }

                input PaymentTemplateListOptions {
                    skip: Int
                    take: Int
                    sort: JSON
                    filter: JSON
                }

                input CreatePaymentTemplateInput {
                    name: String!
                    description: String!
                    code: String!
                    handler: ConfigArgInput!
                    checker: ConfigArgInput
                    isGlobal: Boolean
                }

                input UpdatePaymentTemplateInput {
                    id: ID!
                    name: String
                    description: String
                    code: String
                    handler: ConfigArgInput
                    checker: ConfigArgInput
                }

                extend type Query {
                    paymentTemplates(options: PaymentTemplateListOptions): PaymentTemplateList!
                    paymentTemplate(id: ID!): PaymentTemplate
                }

                extend type Mutation {
                    createPaymentTemplate(input: CreatePaymentTemplateInput!): PaymentTemplate!
                    updatePaymentTemplate(input: UpdatePaymentTemplateInput!): PaymentTemplate!
                    deletePaymentTemplate(id: ID!): Boolean!
                    createPaymentMethodFromTemplate(templateId: ID!, name: String, code: String): PaymentMethod!
                }

                # ===== Room Template =====
                type RoomTemplate {
                    id: ID!
                    createdAt: DateTime!
                    updatedAt: DateTime!
                    code: String!
                    name: String!
                    enabled: Boolean!
                    sortOrder: Int!
                    coverAssetId: ID
                    specs: JSON
                    defaultRooms: JSON
                    basePriceCent: Int!
                    priceCalendar: JSON
                    longStayDiscount: JSON
                    minNights: Int!
                    maxNights: Int!
                    advanceDays: Int!
                    checkInTime: String!
                    checkOutTime: String!
                    cancelPolicy: JSON!
                    depositType: String!
                }

                input RoomTemplateInput {
                    code: String!
                    name: String!
                    enabled: Boolean!
                    sortOrder: Int!
                    coverAssetId: ID
                    specs: JSON
                    defaultRooms: JSON
                    basePriceCent: Int!
                    priceCalendar: JSON
                    longStayDiscount: JSON
                    minNights: Int!
                    maxNights: Int!
                    advanceDays: Int!
                    checkInTime: String!
                    checkOutTime: String!
                    cancelPolicy: JSON!
                    depositType: String!
                }

                extend type Query {
                    roomTemplates: [RoomTemplate!]!
                    roomTemplate(id: ID!): RoomTemplate
                }

                extend type Mutation {
                    createRoomTemplate(input: RoomTemplateInput!): RoomTemplate!
                    updateRoomTemplate(id: ID!, input: RoomTemplateInput!): RoomTemplate!
                    deleteRoomTemplate(id: ID!): Boolean!
                    applyRoomTemplate(variantId: ID!, templateId: ID!): Boolean!
                }

                # ===== 酒店房量管理（房量日历） =====
                type HotelRoomDay {
                    id: ID!
                    productVariantId: ID!
                    "YYYY-MM-DD"
                    date: String!
                    totalRooms: Int!
                    closed: Boolean!
                }

                type HotelAvailabilityDay {
                    "YYYY-MM-DD"
                    date: String!
                    "当晚单价（分）；不含连住折扣"
                    priceCent: Int!
                    "weekday | weekend | holiday | custom"
                    dayType: String!
                    "剩余可订间数；null = 不限房"
                    remaining: Int
                    "关房（不可订）"
                    closed: Boolean!
                }

                extend type Query {
                    "某月已建房量行（month = YYYY-MM）；未建行回退 hotelRoomConfig.totalRooms，由前端兜底展示"
                    hotelRoomDays(variantId: ID!, month: String!): [HotelRoomDay!]!
                    "逐晚房态（占用已扣），[from, to] 含两端；房量日历「剩 N」用"
                    hotelAvailability(variantId: ID!, from: String!, to: String!): [HotelAvailabilityDay!]!
                }

                extend type Mutation {
                    "upsert 单日房量；totalRooms/closed 可选只更新传入字段"
                    setHotelRoomDay(variantId: ID!, date: String!, totalRooms: Int, closed: Boolean): HotelRoomDay!
                    "批量 upsert [from, to] 含两端；weekdays 0-6 可选过滤（0=周日）；返回写入行数"
                    batchSetHotelRoomDays(variantId: ID!, from: String!, to: String!, totalRooms: Int, closed: Boolean, weekdays: [Int!]): Int!
                }

                # ===== 酒店房价方案管理（P2） =====
                input HotelRatePlanInput {
                    code: String
                    name: String
                    "discount | fixed | surcharge"
                    adjustType: String
                    "discount 千分比（900=×0.9）；fixed/surcharge 分"
                    adjustValue: Int
                    "会员等级门槛（数字字符串如 '2'，达到该等级及以上可见）；null/空 = 全员"
                    memberOnly: String
                    "售卖期起（YYYY-MM-DD，以入住日为准含两端）；null = 不限"
                    dateFrom: String
                    "售卖期止；null = 不限"
                    dateTo: String
                    "取消政策覆盖 JSON（{type:'freeUntil'|'nonRefundable', freeUntilHours?}）；null = 用房型级政策"
                    cancelPolicyOverride: String
                    enabled: Boolean
                }

                type HotelRatePlan {
                    id: ID!
                    productVariantId: ID!
                    code: String!
                    name: String!
                    adjustType: String!
                    adjustValue: Int!
                    memberOnly: String
                    dateFrom: String
                    dateTo: String
                    cancelPolicyOverride: String
                    enabled: Boolean!
                }

                extend type Query {
                    "房型全部房价方案（含停用），按 id 升序"
                    hotelRatePlans(variantId: ID!): [HotelRatePlan!]!
                }

                extend type Mutation {
                    "新建方案（code 行内唯一）；校验失败抛错"
                    createHotelRatePlan(variantId: ID!, input: HotelRatePlanInput!): HotelRatePlan!
                    "更新方案（partial：未传字段沿用现值；memberOnly/dateFrom/dateTo/cancelPolicyOverride 显式 null = 清除）"
                    updateHotelRatePlan(id: ID!, input: HotelRatePlanInput!): HotelRatePlan!
                    deleteHotelRatePlan(id: ID!): Boolean!
                }

                # ===== 酒店预订单管理（P3 预订管理页） =====
                input HotelBookingFilterInput {
                    "pendingDeposit | confirmed | checkedIn | completed | cancelled | noShow"
                    status: String
                    variantId: ID
                    orderId: ID
                    orderCode: String
                }

                type HotelBooking {
                    id: ID!
                    orderId: ID!
                    orderLineId: ID!
                    orderCode: String
                    productVariantId: ID!
                    "YYYY-MM-DD"
                    checkIn: String!
                    "YYYY-MM-DD"
                    checkOut: String!
                    nights: Int!
                    roomCount: Int!
                    status: String!
                    ratePlanCode: String
                    "成交总额（分，订单行实付口径）"
                    totalCent: Int!
                    guestName: String
                    guestPhone: String
                    "8 位数字入住码（确认后才有；核销凭码）"
                    bookingCode: String
                    cancelDeadlineAt: DateTime
                    confirmedAt: DateTime
                    checkedInAt: DateTime
                    completedAt: DateTime
                    cancelledAt: DateTime
                    cancelReason: String
                    "实际扣款快照（分；0=免费取消/未付款，null=未取消）"
                    cancelFeeCent: Int
                    "关联退款售后单 id（逾时部分退款/免费取消自动退款）"
                    afterSalesRequestId: ID
                    "已使用改期次数（每单 V1 限改 1 次）"
                    rescheduleCount: Int!
                    "最近改期时间"
                    rescheduledAt: DateTime
                    "是否有在途改期补差价支付"
                    reschedulePending: Boolean!
                    "房型名（admin 列表按语言 enrich；非持久化）"
                    variantName: String
                    createdAt: DateTime!
                    updatedAt: DateTime!
                }

                extend type Query {
                    "预订单列表（filter 可选，id 倒序，上限 200）"
                    hotelBookings(filter: HotelBookingFilterInput): [HotelBooking!]!
                }

                extend type Mutation {
                    "到店核销（凭 8 位入住码）；仅 confirmed 且当日 ∈ [checkIn, checkOut)，否则抛错"
                    hotelBookingCheckIn(code: String!): HotelBooking!
                    "完成离店（仅已入住 checkedIn）"
                    hotelBookingComplete(id: ID!): HotelBooking!
                    "强制取消（pendingDeposit/confirmed → cancelled 并释放锁房；退款走售后单）"
                    hotelBookingForceCancel(id: ID!, reason: String): HotelBooking!
                }

                # ===== 租户 / 角色 / 权限体系 =====
                type TenantMember implements Node {
                    id: ID!
                    administratorId: ID!
                    channelId: ID!
                    enabled: Boolean!
                    mustChangePassword: Boolean!
                    displayName: String
                    remark: String
                    phone: String
                    emailAddress: String
                    roleIds: [ID!]!
                    canResetPassword: Boolean!
                    shippingProfileIds: [ID!]!
                    createdAt: DateTime!
                    initialPassword: String
                }

                extend type Role {
                    grantable: Boolean
                }

                input CreateTenantInput {
                    name: String!
                    token: String
                    isOfficial: Boolean
                    defaultLanguageCode: LanguageCode
                    currencyCode: CurrencyCode
                    customDomains: [String!]
                    domain: String
                    extraCustomFields: JSON
                }

                input UpdateTenantInput {
                    name: String
                    tenantNo: Int
                    isOfficial: Boolean
                    domain: String
                    industryType: String
                    storefrontMode: String
                    storefrontHomeLayout: String
                    couponFloorGroups: String
                    # 运营设置（service 已支持落库，此处补齐声明；均为可空局部更新）
                    firstBuyDiscount: Int
                    # couponCampaign 以 JSON 字符串存储（Channel customFields 为 string(4096)）
                    couponCampaign: String
                    billpayMaxSalePrice: Int
                    billpayMaxFaceValue: Int
                    billpayMaxBundleTotal: Int
                    billpayMinValidDays: Int
                    billpayExpireRefundPolicy: String
                }

                input TenantFilterInput {
                    keyword: String
                    status: String
                }

                input TenantListOptions {
                    skip: Int
                    take: Int
                    filter: TenantFilterInput
                }

                # 必须用独立的 TenantList 类型（而不是 ChannelList）：
                # Vendure 的 generateListOptions 会把「返回 XxxList」的查询 options 参数
                # 按实体自动改写为 XxxListOptions（此处即 ChannelListOptions），
                # 导致 filter.keyword/status 被替换成 ChannelFilterParameter 而校验失败。
                type TenantList implements PaginatedList {
                    totalItems: Int!
                    items: [Channel!]!
                }

                input CreateTenantAdministratorInput {
                    firstName: String
                    lastName: String
                    emailAddress: String!
                    password: String
                    roleIds: [ID!]!
                    displayName: String
                    remark: String
                    phone: String
                    enabled: Boolean
                    forcePasswordChange: Boolean
                }

                input CreateTenantRoleInput {
                    code: String!
                    description: String!
                    permissions: [String!]!
                }

                input UpdateTenantRoleInput {
                    code: String
                    description: String
                    permissions: [String!]
                }

                input CreateTenantMemberInput {
                    firstName: String
                    lastName: String
                    emailAddress: String!
                    password: String
                    roleIds: [ID!]!
                    displayName: String
                    remark: String
                    phone: String
                    enabled: Boolean
                    forcePasswordChange: Boolean
                }

                type MyTenantChannel {
                    id: ID!
                    code: String!
                    token: String!
                    name: String!
                    enabled: Boolean!
                    tenantNo: Int
                    isOfficial: Boolean!
                    memberEnabled: Boolean!
                    mustChangePassword: Boolean!
                }

                type MyTenantAccess {
                    isSuperAdmin: Boolean!
                    channels: [MyTenantChannel!]!
                    permissions: [String!]!
                    mustChangePassword: Boolean!
                }

                type PermissionCatalogItem {
                    code: String!
                    label: String!
                }
                type PermissionCatalogGroup {
                    key: String!
                    label: String!
                    items: [PermissionCatalogItem!]!
                }
                type RoleTemplate {
                    key: String!
                    busiPrefix: String!
                    description: String!
                    permissions: [String!]!
                }

                # 租户位：预留容量（capacity）与第 n 个位置的占用情况
                type TenantSlot {
                    no: Int!
                    occupied: Boolean!
                    tenantId: ID
                    name: String
                }
                type TenantSlots {
                    capacity: Int!
                    used: Int!
                    slots: [TenantSlot!]!
                }

                # 关联已有账号：平台账号搜索候选
                type TenantAdminCandidate {
                    id: ID!
                    emailAddress: String!
                    displayName: String
                    linkedCount: Int!
                    linkedChannelIds: [ID!]!
                    alreadyLinked: Boolean!
                }

                extend type Query {
                    permissionCatalog: [PermissionCatalogGroup!]
                    tenants(options: TenantListOptions): TenantList!
                    tenant(id: ID!): Channel
                    tenantSlots: TenantSlots!
                    tenantAdministrators(channelId: ID!): [TenantMember!]!
                    tenantRoles(channelId: ID!): [Role!]!
                    tenantMembers: [TenantMember!]!
                    myTenantRoles: [Role!]!
                    myTenantAccess(channelId: ID): MyTenantAccess!
                    globalRoles: [Role!]!
                    globalRoleTemplates: [RoleTemplate!]!
                    myGlobalRolesAvailable: [Role!]!
                    tenantSearchAdmins(channelId: ID!, keyword: String!): [TenantAdminCandidate!]!
                    mySearchAdmins(keyword: String!): [TenantAdminCandidate!]!
                }

                extend type Mutation {
                    createTenant(input: CreateTenantInput!): Channel!
                    updateTenant(id: ID!, input: UpdateTenantInput!): Channel!
                    setTenantEnabled(id: ID!, enabled: Boolean!): Channel!
                    deleteTenant(id: ID!): Boolean!
                    clearTenantProducts(channelId: ID!): Int!
                    createTenantAdministrator(channelId: ID!, input: CreateTenantAdministratorInput!): TenantMember!
                    setTenantAdministratorEnabled(id: ID!, enabled: Boolean!): TenantMember!
                    deleteTenantAdministrator(id: ID!): Boolean!
                    "重置后返回一次性随机口令（24 小时内有效，仅本次返回，不落日志/库）"
                    resetTenantAdministratorPassword(memberId: ID!): String!
                    createTenantRole(channelId: ID!, input: CreateTenantRoleInput!): Role!
                    updateTenantRole(roleId: ID!, input: UpdateTenantRoleInput!): Role!
                    deleteTenantRole(roleId: ID!): Boolean!
                    importDefaultRoles(channelId: ID!): [Role!]!
                    createGlobalRole(channelIds: [ID!]!, input: CreateTenantRoleInput!): [Role!]!
                    referGlobalRoleToChannel(roleId: ID!, channelId: ID!): Boolean!
                    unreferGlobalRoleFromChannel(roleId: ID!, channelId: ID!): Boolean!
                    myReferGlobalRole(roleId: ID!): Boolean!
                    myUnreferGlobalRole(roleId: ID!): Boolean!
                    myImportDefaultRoles: [Role!]!
                    createTenantMember(input: CreateTenantMemberInput!): TenantMember!
                    setTenantMemberEnabled(id: ID!, enabled: Boolean!): TenantMember!
                    deleteTenantMember(id: ID!): Boolean!
                    myCreateTenantRole(input: CreateTenantRoleInput!): Role!
                    myUpdateTenantRole(roleId: ID!, input: UpdateTenantRoleInput!): Role!
                    myDeleteTenantRole(roleId: ID!): Boolean!
                    updateTenantMemberRoles(id: ID!, channelId: ID!, roleIds: [ID!]!): Boolean!
                    myUpdateTenantMemberRoles(id: ID!, roleIds: [ID!]!): Boolean!
                    tenantLinkMember(channelId: ID!, administratorId: ID!, roleIds: [ID!]!, displayName: String, phone: String, remark: String): TenantMember!
                    myLinkMember(administratorId: ID!, roleIds: [ID!]!, displayName: String, phone: String, remark: String): TenantMember!
                    "重置本租户成员密码，返回一次性随机口令（24 小时内有效，仅本次返回）"
                    myResetTenantMemberPassword(id: ID!): String!
                    setTenantMemberRedeemProfiles(id: ID!, shippingProfileIds: [ID!]!): TenantMember!
                    mySetTenantMemberRedeemProfiles(id: ID!, shippingProfileIds: [ID!]!): TenantMember!
                    tenantChangeMyPassword(oldPassword: String, newPassword: String!): Boolean!
                    myUpdateChannelCustomFields(input: JSON!): JSON!
                }

                # ===== 全局共享余额钱包 =====
                type Wallet implements Node {
                    id: ID!
                    balance: Int!
                    currencyCode: String
                    createdAt: DateTime
                    updatedAt: DateTime
                }

                extend type Query {
                    wallet: Wallet!
                }

                extend type Mutation {
                    adminCreditWallet(amount: Int!): Wallet!
                    adminDebitWallet(amount: Int!): Wallet!
                }

                extend type Mutation {
                    createTenantCollection(input: CreateCollectionInput!): Collection!
                    mapProductToPlatformCollection(productId: ID!, collectionId: ID!): Boolean!
                    moveProductsToTenantChannel(productIds: [ID!]!, channelId: ID!): Int!
                }

                type ReusableOptionValue {
                    id: ID!
                    name: String!
                }
                type ReusableOptionGroup {
                    id: ID!
                    name: String!
                    options: [ReusableOptionValue!]!
                }
                extend type Query {
                    reusableOptionGroups: [ReusableOptionGroup!]!
                }
                extend type Mutation {
                    reuseOptionGroupForProduct(productId: ID!, optionGroupId: ID!): Boolean!
                }

                type AssetLibraryItem {
                    id: ID!
                    name: String
                    preview: String
                    source: String
                    mimeType: String
                    width: Int
                    height: Int
                    assetTags: [String!]!
                }

                type AssetLibraryResult {
                    items: [AssetLibraryItem!]!
                    totalItems: Int!
                }

                type AssetTagSummary {
                    name: String!
                    count: Int!
                }

                type MerchantSettlementLedgerItem {
                    id: ID!
                    orderId: String
                    orderCode: String
                    tenantChannelId: String
                    tenantName: String
                    amount: Int!
                    settleMethod: String
                    status: String
                    occurredAt: String
                    collectorChannelId: String
                    collectorName: String
                    collectedAt: String
                }

                extend type Query {
                    assetLibrary(take: Int, skip: Int, tags: [String], ids: [String]): AssetLibraryResult!
                    assetTags(take: Int): [AssetTagSummary!]!
                    merchantSettlementLedgers(orderId: String): [MerchantSettlementLedgerItem!]!
                }

                extend type Mutation {
                    setAssetTags(assetIds: [String!]!, tags: [String!]): Boolean!
                }

                ${redemptionAdminSchema}

                type DeliveryRecord {
                    id: ID!
                    orderId: ID!
                    fulfillmentId: ID
                    sourceLocationId: ID
                    mode: String!
                    status: String!
                    expressCompany: String
                    trackingNo: String
                    staffId: String
                    staffName: String
                    receiverName: String
                    receiverPhone: String
                    receiverAddress: String
                    lat: Float
                    lng: Float
                    pickupLocationId: ID
                    fromLocationId: ID
                    toLocationId: ID
                    itemsJson: String
                    sentAt: DateTime
                    deliveredAt: DateTime
                    returnedAt: DateTime
                    exceptionAt: DateTime
                    photos: String
                    remark: String
                    orderBoxId: String
                }

                extend type Query {
                    deliveryRecords(orderId: ID): [DeliveryRecord!]!
                }

                extend type Mutation {
                    deliveryTransition(id: ID!, to: String!): DeliveryRecord!
                    deliverySetExpress(id: ID!, expressCompany: String!, trackingNo: String!): DeliveryRecord!
                    deliveryAssignStaff(id: ID!, staffId: String!, staffName: String): DeliveryRecord!
                    deliveryCreateTransfer(orderId: ID!, fromLocationId: ID!, toLocationId: ID!, itemsJson: String!): DeliveryRecord!
                    deliveryTransferArrived(id: ID!): DeliveryRecord!
                    setVariantBindings(variantId: ID!, bindings: [VariantBindingInput!]!): [VariantLocationBinding!]!
                }

                type VariantLocationBinding {
                    id: ID!
                    variantId: ID!
                    locationId: ID!
                    isDefault: Boolean!
                }

                input VariantBindingInput {
                    locationId: ID!
                    isDefault: Boolean!
                }

                type ReconciliationBatch {
                    id: ID!
                    tenantChannelId: ID!
                    date: String!
                    status: String!
                    d1Count: Int!
                    d2Count: Int!
                    d3Count: Int!
                    d4Count: Int!
                    orderTotal: Int!
                    trigger: String!
                    startedAt: String
                    finishedAt: String
                }

                type ReconciliationOrderLine {
                    id: ID!
                    batchId: ID!
                    orderId: ID!
                    diffTypes: String!
                    status: String!
                    remark: String
                    fixedAt: String
                    fixerId: String
                }

                extend type Query {
                    reconciliationBatches: [ReconciliationBatch!]!
                    reconciliationLines(batchId: ID!): [ReconciliationOrderLine!]!
                }

                extend type Mutation {
                    runReconciliation(date: String!, trigger: String): ReconciliationBatch
                    rerunReconciliationOrder(lineId: ID!): ReconciliationOrderLine!
                }

                type StockDoc {
                    id: ID!
                    code: String!
                    type: String!
                    remark: String
                    operator: String
                    createdAt: String!
                }

                input StockDocItemInput {
                    variantId: ID!
                    fromStockLocationId: ID
                    toStockLocationId: ID
                    qty: Int!
                    realQty: Int
                    costPrice: Int
                    binId: ID
                    zoneId: ID
                }

                input StockDocCreateInput {
                    type: String!
                    remark: String
                    operator: String
                    items: [StockDocItemInput!]!
                }

                # 库存流水输出类型必须在本插件 SDL 内独立命名定义：
                # 复用 inventory-plugin 的 StockLedgerEntry/StockLedgerList 会因两插件重复同名注册而
                # schema 崩溃（"Type already exists"）；只引用不定义则报 Unknown type。
                type StockDocLedgerEntry {
                    id: ID!
                    code: String!
                    productVariantId: ID!
                    stockLocationId: ID!
                    bizType: String!
                    bizCode: String
                    orderLineId: ID
                    direction: String!
                    quantity: Int!
                    beforeOnHand: Int
                    afterOnHand: Int
                    otherLocationId: ID
                    reason: String
                    createdAt: DateTime!
                }

                # 同条件入/出合计（Task 3 新增；分页不影响汇总口径）
                type StockDocLedgerSummary {
                    inQty: Int!
                    outQty: Int!
                }

                type StockDocLedgerList {
                    items: [StockDocLedgerEntry!]!
                    totalItems: Int!
                    summary: StockDocLedgerSummary!
                }

                extend type Mutation {
                    createStockDoc(input: StockDocCreateInput!): StockDoc!
                }

                extend type Query {
                    # Task 3：新增 bizType/direction/from/to 入参（全部可选，向后兼容）
                    stockMovementLedger(productVariantId: ID, locationId: ID, bizCode: String, orderLineId: ID, bizType: String, direction: String, from: String, to: String, page: Int, pageSize: Int): StockDocLedgerList!
                }

                # 预留单 admin 输出类型（独立命名，定义在本插件 SDL 内）
                type ReservationItem {
                    id: ID!
                    reservationId: ID!
                    stockLocationId: ID!
                    qty: Int!
                    fulfillType: String!
                    status: String!
                }
                type Reservation {
                    id: ID!
                    orderId: ID!
                    orderLineId: ID!
                    variantId: ID!
                    totalQty: Int!
                    status: String!
                    tenantChannelId: String
                    createdAt: DateTime!
                    expiresAt: DateTime
                    items: [ReservationItem!]!
                }
                type ReservationList {
                    items: [Reservation!]!
                    totalItems: Int!
                }
                type ReservationReconcileRow {
                    variantId: ID!
                    physicalSum: Int!
                    virtualSum: Int!
                    pendingQty: Int!
                    diff: Int!
                }
                input ReservationSplitInput {
                    locationId: ID!
                    fulfillType: String!
                    qty: Int!
                }
                extend type Query {
                    reservations(status: String, variantId: ID, orderId: ID, page: Int, pageSize: Int): ReservationList!
                    reservation(id: ID!): Reservation!
                    reservationReconcile: [ReservationReconcileRow!]!
                }
                extend type Mutation {
                    allocateReservation(id: ID!, splits: [ReservationSplitInput!]!): Reservation!
                    fulfillReservationItem(id: ID!, quantity: Int): ReservationItem!
                    releaseReservation(id: ID!): Reservation!
                }

                # ===== 配送能力派生（唯一真源：配送档案 mode） =====
                # 与 shopApiExtensions 中的同名类型/字段保持一致（两套 SDL 独立，必须各自注册）
                type ChannelDeliveryCapability {
                    modes: [String!]!
                    bothSupported: Boolean!
                    source: String!
                    facetValueIds: JSON
                }
                type VariantDeliveryModes {
                    variantId: ID!
                    modes: [String!]!
                }
                extend type Query {
                    channelDeliveryCapability: ChannelDeliveryCapability!
                    variantDeliveryModes(variantIds: [ID!]!): [VariantDeliveryModes!]!
                }
                extend type Mutation {
                    rebuildDeliveryFacetIndex: Boolean!
                }

                # ===== 租户库存仓管理（编码/性质由服务端生成，前端不可指定） =====
                type TenantStockLocation {
                    id: ID!
                    name: String!
                    code: String!
                    kind: String!
                    isSystem: Boolean!
                    deliveryMethods: [String!]
                    serviceCities: [String!]
                    lat: Float
                    lng: Float
                }
                type TenantInventoryOverview {
                    channelCode: String!
                    physicalStockEnabled: Boolean!
                    virtualCode: String!
                    virtualLocationId: ID
                    defaultPhysicalCode: String!
                    defaultPhysicalLocationId: ID
                    locations: [TenantStockLocation!]!
                }
                input TenantStockLocationInput {
                    name: String!
                    deliveryMethods: [String!]
                    serviceCities: [String!]
                    lat: Float
                    lng: Float
                }
                input UpdateTenantStockLocationInput {
                    id: ID!
                    name: String
                    deliveryMethods: [String!]
                    serviceCities: [String!]
                    lat: Float
                    lng: Float
                }
                extend type Query {
                    tenantInventoryOverview: TenantInventoryOverview!
                    # 租户级变体绑定读：平台侧 setVariantBindings 走 ViewStock（超管语义、租户恒 403），
                    # 本店改用租户白名单权限（ReadCatalog / ReadStockLocation）的独立入口。
                    tenantVariantBindings(variantId: ID!): [VariantLocationBinding!]!
                }
                extend type Mutation {
                    ensureTenantInventoryLocations: TenantInventoryOverview!
                    createTenantStockLocation(input: TenantStockLocationInput!): TenantInventoryOverview!
                    updateTenantStockLocation(input: UpdateTenantStockLocationInput!): TenantInventoryOverview!
                    deleteTenantStockLocation(id: ID!): TenantInventoryOverview!
                    # 租户级变体绑定写（@Allow(UpdateStockLocation)，非 ViewStock），归属校验同平台侧
                    setTenantVariantBindings(variantId: ID!, bindings: [VariantBindingInput!]!): [VariantLocationBinding!]!
                }

                # ===== 库存明细聚合页（Plan 2）：一次请求拿齐 KPI / 分桶计数 / 明细行 =====
                input InventoryStockQueryInput {
                    locationId: ID
                    keyword: String
                    bucket: String
                    sort: String
                    page: Int
                    pageSize: Int
                }
                type InventoryStockSummary {
                    skuCount: Int!
                    onHandTotal: Int!
                    allocatedTotal: Int!
                    availableTotal: Int!
                    valueTotal: Int!
                    outCount: Int!
                    lowCount: Int!
                    okCount: Int!
                    outbound7d: Int!
                }
                type InventoryStockRow {
                    variantId: ID!
                    productId: ID
                    variantName: String!
                    sku: String!
                    optionText: String
                    thumbnail: String
                    stockLocationId: ID
                    locationName: String
                    onHand: Int!
                    allocated: Int!
                    available: Int!
                    safetyStock: Int!
                    value: Int!
                    costPrice: Int
                    bucket: String!
                    lastMovementAt: String
                    lastDirection: String
                    lastBizType: String
                }
                type InventoryStockPage {
                    totalItems: Int!
                    summary: InventoryStockSummary!
                    items: [InventoryStockRow!]!
                }
                extend type Query {
                    inventoryStockPage(input: InventoryStockQueryInput): InventoryStockPage!
                }

                # ===== 库存预警规则（安全库存；Plan 2） =====
                type InventoryAlertRule {
                    variantId: ID!
                    locationId: ID
                    safetyStock: Int!
                    enabled: Boolean!
                }
                input InventoryAlertRuleInput {
                    variantId: ID!
                    safetyStock: Int!
                    enabled: Boolean
                    locationId: ID
                }
                extend type Query {
                    inventoryAlertRules(locationId: ID): [InventoryAlertRule!]!
                }
                extend type Mutation {
                    saveInventoryAlertRules(locationId: ID, items: [InventoryAlertRuleInput!]!): [InventoryAlertRule!]!
                }

                # ===== 单据中心（单据列表；Plan 2） =====
                type StockDocSummaryRow {
                    id: ID!
                    code: String!
                    type: String!
                    remark: String
                    operator: String
                    createdAt: String!
                    itemCount: Int!
                    totalQty: Int!
                    # 盘点任务反查（D44）：type='STOCKTAKE' 时，由盘点任务过账生成的单据回填任务 id/任务号；
                    # 库存明细页「调整」产生的手工调数单同 type 但无任务引用，两字段为 null
                    taskId: ID
                    taskCode: String
                }
                type StockDocList {
                    totalItems: Int!
                    items: [StockDocSummaryRow!]!
                }
                extend type Query {
                    stockDocList(type: String, locationId: ID, from: String, to: String, operator: String, page: Int, pageSize: Int): StockDocList!
                }

                # ===== 作业员明细聚合（D46）=====
                # 为什么要单独一条：stockDocList 的 pageSize 被服务端 clamp 到 ≤100，
                # 窗口内单据超过 100 条时较老单据被截断、低频作业员整行消失（看板 KPI 系统性低估）。
                # 聚合在 SQL 侧完成，返回行数 = 操作人数，无上限；口径 = 排除 STOCKTAKE（见 service 注释）。
                type StockDocOperatorStat {
                    # 空串 = 未记录操作人（前端渲染为「未记录」占位）
                    operator: String!
                    count: Int!
                    qty: Int!
                }
                extend type Query {
                    stockDocOperatorStats(from: String, to: String): [StockDocOperatorStat!]!
                }

                # ===== 配货台（拣货批次） =====
                type PickBatch implements Node {
                    id: ID!
                    code: String!
                    stockLocationId: Int!
                    state: String!
                    note: String
                    createdBy: String
                    memberCount: Int!
                    itemCount: Int!
                    members: [JSON!]
                    pickedAt: DateTime
                    printedAt: DateTime
                    shippedAt: DateTime
                    handoverAt: DateTime
                    handoverTo: String
                    reviewedAt: DateTime
                    exceptionAt: DateTime
                    exceptionNote: String
                    createdAt: DateTime!
                }

                type PickBatchList {
                    totalItems: Int!
                    items: [PickBatch!]!
                }

                type PickBatchCandidateList {
                    totalItems: Int!
                    items: [JSON!]!
                }

                type PickBatchPickingRow {
                    sku: String!
                    name: String!
                    qty: Int!
                    orderCodes: [String!]!
                    binCode: String
                    zoneCode: String
                    zoneName: String
                    pathIndex: Int!
                }

                input PickBatchListOptions {
                    page: Int
                    pageSize: Int
                    state: String
                    stockLocationId: ID
                }

                input CreatePickBatchInput {
                    stockLocationId: ID!
                    orderIds: [ID!]!
                    note: String
                }

                input ShipPickBatchInput {
                    method: String!
                    trackingCode: String
                }

                input OrderAddressInput {
                    fullName: String
                    phoneNumber: String
                    province: String
                    city: String
                    streetLine1: String
                    streetLine2: String
                    postalCode: String
                    countryCode: String
                }

                extend type Query {
                    pickBatches(options: PickBatchListOptions): PickBatchList!
                    pickBatch(id: ID!): PickBatch
                    pickBatchPickingList(id: ID!): [PickBatchPickingRow!]!
                    pickBatchCandidates(options: PickBatchListOptions): PickBatchCandidateList!
                }

                # ===== 看板「拣货单数」KPI 聚合（D48）=====
                # 为什么单独一条：pickBatches 的 pageSize 被服务端硬顶 100，
                # 前端「取最近 100 条 + 客户端按窗口过滤」在窗口内批次 > 100 时静默低估。
                # 口径 = SHIPPED / HANDOVER / REVIEWED 且 createdAt 落在 [from, to]。
                extend type Query {
                    pickBatchShippedCount(from: String, to: String): Int!
                }

                extend type Mutation {
                    createPickBatch(input: CreatePickBatchInput!): PickBatch!
                    addOrdersToPickBatch(batchId: ID!, orderIds: [ID!]!): PickBatch!
                    removeOrdersFromPickBatch(batchId: ID!, orderIds: [ID!]!): PickBatch!
                    advancePickBatchState(batchId: ID!, to: String!): PickBatch!
                    cancelPickBatch(batchId: ID!): PickBatch!
                    shipPickBatch(batchId: ID!, input: ShipPickBatchInput!): JSON!
                    handoverPickBatch(batchId: ID!, handoverTo: String!): PickBatch!
                    registerPickBatchException(batchId: ID!, reason: String!): PickBatch!
                    updateOrderShippingAddress(orderId: ID!, input: OrderAddressInput!): JSON!
                }

                # ===== 库区/库位（三档开关 off/zone/bin 共用同一套接口） =====
                type StorageZone implements Node {
                    id: ID!
                    code: String!
                    name: String!
                    sortOrder: Int!
                    enabled: Boolean!
                }

                type StorageBin implements Node {
                    id: ID!
                    zoneId: ID!
                    code: String!
                    rowNo: Int!
                    levelNo: Int!
                    enabled: Boolean!
                }

                input BindVariantBinInput {
                    variantId: ID!
                    stockLocationId: ID!
                    zoneId: ID!
                    binId: ID
                }

                extend type Query {
                    storageZones(stockLocationId: ID!): [StorageZone!]!
                    storageBins(stockLocationId: ID!, zoneId: ID): [StorageBin!]!
                    variantBin(variantId: ID!, stockLocationId: ID!): JSON
                }

                type VariantBinPage { totalItems: Int!, items: [VariantBinItem!]! }
                type VariantBinItem {
                    bindingId: ID!
                    variantId: ID!
                    sku: String!
                    variantName: String!
                    barcode: String
                    internalCode: String
                    zoneId: ID!
                    zoneCode: String!
                    zoneName: String!
                    binId: ID
                    binCode: String
                    rowNo: Int
                    levelNo: Int
                    isDefault: Boolean!
                }
                type BinOccupancy {
                    zoneId: ID!
                    zoneCode: String!
                    zoneName: String!
                    binId: ID!
                    binCode: String!
                    rowNo: Int
                    levelNo: Int
                    skuCount: Int!
                }
                extend type Query {
                    variantBinsByLocation(stockLocationId: ID!, zoneId: ID, binId: ID, keyword: String, includeDisabled: Boolean, page: Int, pageSize: Int): VariantBinPage!
                    binOccupancy(stockLocationId: ID!, zoneId: ID): [BinOccupancy!]!
                }

                extend type Mutation {
                    generateStandardBins(stockLocationId: ID!): JSON!
                    bindVariantToBin(input: BindVariantBinInput!): JSON!
                    unbindVariantFromBin(variantId: ID!, stockLocationId: ID!): Boolean!
                    deleteStorageBin(id: ID!): Boolean!
                }

                type StocktakeTask {
                    id: ID!
                    code: String!
                    stockLocationId: ID!
                    locationName: String
                    activityCode: String
                    name: String!
                    scopeJson: String!
                    binModeAtCreate: String!
                    state: String!
                    createdById: String
                    createdByName: String
                    postedStockDocId: ID
                    postedAt: DateTime
                    note: String
                    createdAt: DateTime!
                    expectedTotal: Int!
                    countedTotal: Int!
                    waveCount: Int!
                    submittedWaveCount: Int!
                }
                type StocktakeTaskList { totalItems: Int!, items: [StocktakeTask!]! }
                type StocktakeWave {
                    id: ID!
                    taskId: ID!
                    scopeType: String!
                    zoneId: ID
                    zoneCode: String
                    zoneName: String
                    assigneeId: String
                    assigneeName: String
                    state: String!
                    expectedCount: Int!
                    countedCount: Int!
                    claimedAt: DateTime
                    submittedAt: DateTime
                }
                type StocktakeLine {
                    id: ID!
                    taskId: ID!
                    waveId: ID!
                    variantId: ID!
                    variantSku: String!
                    variantName: String!
                    zoneId: ID
                    binId: ID
                    zoneCode: String
                    binCode: String
                    bookQty: Int!
                    countedQty: Int
                    isExtra: Boolean!
                    countedById: String
                    countedByName: String
                    countedAt: DateTime
                    note: String
                }
                type StocktakeLinePage { totalItems: Int!, items: [StocktakeLine!]! }
                type StocktakeVarianceRow {
                    variantId: ID!
                    variantSku: String!
                    variantName: String!
                    countedTotal: Int!
                    bookQty: Int!
                    diff: Int!
                    isExtra: Boolean!
                    binChanged: Boolean!
                    targetZoneId: ID
                    targetBinId: ID
                    targetBinCode: String
                    targetZoneCode: String
                    snapBookQty: Int!
                    currentBookQty: Int!
                }
                type StocktakeBookChange { variantId: ID!, variantSku: String!, snapBookQty: Int!, currentBookQty: Int! }
                type StocktakeDiff {
                    expectedTotal: Int!
                    countedTotal: Int!
                    uncountedCount: Int!
                    extraCount: Int!
                    diffCount: Int!
                    rows: [StocktakeVarianceRow!]!
                    uncountedLines: [StocktakeLine!]!
                    recheck: Boolean!
                    changedVariants: [StocktakeBookChange!]!
                }
                type StocktakeScanHit {
                    kind: String!
                    binId: ID
                    binCode: String
                    zoneId: ID
                    lineId: ID
                    variantId: ID
                    variantSku: String
                    variantName: String
                    message: String
                }
                type StocktakePostResult { ok: Boolean!, stockDocId: ID, diff: StocktakeDiff, message: String }
                type StocktakeBinStat {
                    zoneId: ID
                    zoneCode: String
                    binId: ID
                    binCode: String
                    expectedLines: Int!
                    countedLines: Int!
                    uncountedLines: Int!
                    extraLines: Int!
                }
                type StocktakeCounterStat {
                    countedById: String
                    countedByName: String
                    countedLines: Int!
                    extraLines: Int!
                    waveCount: Int!
                    lastCountedAt: DateTime
                }
                type StocktakeStats {
                    expectedLines: Int!
                    countedLines: Int!
                    byBin: [StocktakeBinStat!]!
                    byCounter: [StocktakeCounterStat!]!
                }
                type StocktakeExportFile { filename: String!, mimeType: String!, content: String!, totalRows: Int!, truncated: Boolean! }
                input StocktakeScopeInput { zones: [Int!], categoryIds: [Int!], variantIds: [Int!], includeZeroBook: Boolean }
                input StocktakeTaskInput {
                    stockLocationId: ID!
                    name: String!
                    activityCode: String
                    scope: StocktakeScopeInput
                    autoSplitByZone: Boolean
                    note: String
                    state: String
                }
                input StocktakeTaskUpdateInput { name: String, activityCode: String, note: String, stockLocationId: ID, scope: StocktakeScopeInput, autoSplitByZone: Boolean }
                input StocktakeWaveInput { scopeType: String!, zoneId: ID }
                input StocktakeCountEntryInput { lineId: ID, variantId: ID, countedQty: Int!, zoneId: ID, binId: ID, note: String }
                input StocktakeLineFilterInput { onlyCounted: Boolean, onlyUncounted: Boolean, onlyDiff: Boolean, onlyExtra: Boolean }
                input StocktakeTaskOptionsInput { page: Int, pageSize: Int, state: String, states: [String!], activityCode: String, stockLocationId: ID }

                # ===== 看板盘库 KPI 聚合（D48）=====
                # 为什么单独一条：stocktakeTasks 的 pageSize 被服务端硬顶 100，旧前端「取最近 100 条 +
                # 客户端按窗口过滤 + 逐任务取 stocktakeDiff」在窗口内任务 > 100 时让「盘库次数 / 差异率 /
                # 差异趋势」同源同步失真。服务端先判定窗口内任务（无上限）再聚合；days 覆盖窗口每一天。
                type StocktakeKpiDay { day: String! expected: Int! diff: Int! }
                type StocktakeKpi {
                    taskCount: Int!
                    expectedTotal: Int!
                    diffTotal: Int!
                    days: [StocktakeKpiDay!]!
                }
                extend type Query {
                    stocktakeKpi(from: String, to: String): StocktakeKpi!
                }
                extend type Query {
                    stocktakeTasks(options: StocktakeTaskOptionsInput): StocktakeTaskList!
                    stocktakeTask(id: ID!): StocktakeTask
                    stocktakeWaves(taskId: ID!): [StocktakeWave!]!
                    stocktakeExpectedLines(taskId: ID!, waveId: ID, filter: StocktakeLineFilterInput, keyword: String, page: Int, pageSize: Int): StocktakeLinePage!
                    stocktakeDiff(taskId: ID!): StocktakeDiff!
                    stocktakeResolveCode(taskId: ID!, code: String!): StocktakeScanHit!
                    stocktakeStats(taskId: ID!): StocktakeStats!
                    stocktakeExport(taskId: ID!, kind: String!): StocktakeExportFile!
                }
                extend type Mutation {
                    createStocktakeTask(input: StocktakeTaskInput!): StocktakeTask!
                    openStocktakeTask(taskId: ID!): StocktakeTask!
                    updateStocktakeTask(taskId: ID!, input: StocktakeTaskUpdateInput!): StocktakeTask!
                    addStocktakeWave(taskId: ID!, input: StocktakeWaveInput!): StocktakeWave!
                    assignStocktakeWave(waveId: ID!, assigneeId: String): StocktakeWave!
                    claimStocktakeWave(waveId: ID!): StocktakeWave!
                    releaseStocktakeWave(waveId: ID!): StocktakeWave!
                    saveStocktakeCounts(waveId: ID!, inputs: [StocktakeCountEntryInput!]!): StocktakeWave!
                    submitStocktakeWave(waveId: ID!): StocktakeWave!
                    postStocktake(taskId: ID!, confirm: Boolean): StocktakePostResult!
                    cancelStocktakeTask(taskId: ID!): StocktakeTask!
                    cancelStocktakeWave(waveId: ID!): StocktakeWave!
                }

                # ===== 后台改价（F-WA-08） =====
                input AdjustOrderPriceInput {
                    orderId: ID!
                    # 差额（分）：正数加价，负数降价；服务端按渠道上限强校验
                    amount: Int!
                    note: String
                }
                extend type Mutation {
                    adjustOrderPrice(input: AdjustOrderPriceInput!): Order!
                }
                input ScopedOrderFilterInput {
                    states: [String!]
                    timeStart: String
                    timeEnd: String
                    keyword: String
                    deliveryType: String
                    exceptionType: String
                    exceptionOnly: Boolean
                    afterSales: [String!]
                }
                # implements PaginatedList：@Relations 装饰器靠该接口识别分页查询并下钻 items
                # 计算 selection relations（含 Calculated 字段依赖），否则返回空数组导致
                # totalQuantity 等 getter 在序列化时抛「relation not joined」
                type ScopedOrderList implements PaginatedList { totalItems: Int!, items: [Order!]! }
                type NewOrderSignal { count: Int!, latestCreatedAt: DateTime }
                extend type Query {
                    scopedOrders(filter: ScopedOrderFilterInput, take: Int, skip: Int): ScopedOrderList!
                    scopedOrderCounts(filters: [ScopedOrderFilterInput!]): [Int!]!
                    newOrderSignal(since: DateTime!): NewOrderSignal!
                }
                `;
        },
        resolvers: [PickupLocationAdminResolver, EmployeeCustomerAdminResolver, AuthAdminResolver, MapAdminResolver, TenantConfigAdminResolver, ShippingTemplateAdminResolver, ShippingProfileAdminResolver, PaymentProfileAdminResolver, PaymentTemplateAdminResolver, RoomTemplateAdminResolver, TenantAdminResolver, TenantMemberResolver, MyAccessResolver, WalletAdminResolver, TenantCatalogAdminResolver, AssetLibraryAdminResolver, RedemptionAdminResolver, MerchantSettlementAdminResolver, DeliveryAdminResolver, InventoryAdminResolver, ReconciliationAdminResolver, StockDocAdminResolver, StockReservationAdminResolver, DeliveryCapabilityResolver, PickBatchAdminResolver, StocktakeAdminResolver, OrderAddressAdminResolver, StocktakeAdminResolver, OrderPriceAdminResolver, HotelInventoryAdminResolver, HotelRatePlanAdminResolver, HotelBookingAdminResolver, OrderScopeAdminResolver, StorageBinAdminResolver],
    },
    shopApiExtensions: {
        schema: () => {
            const { gql } = require('graphql-tag');
            return gql`
                extend type Query {
                    pickupLocations(type: String, lat: Float, lng: Float): [PickupLocation!]!
                    employeePickupLocations(lat: Float, lng: Float): [PickupLocation!]!
                }

                extend type Mutation {
                    setOrderPickupLocation(pickupLocationId: ID!, pickupType: String!): Order!
                }

                type PickupLocation {
                    id: ID!
                    name: String!
                    type: String!
                    address: String!
                    contactPerson: String
                    phoneNumber: String
                    businessHours: String
                    coordinates: JSON
                    partner: String
                    photos: JSON
                    remark: String
                    isPublic: Boolean!
                    province: String
                    city: String
                    district: String
                    street: String
                }

                type AuthMethodsResult {
                    methods: [String!]!
                    wechatAppId: String
                }
                extend type Query {
                    authMethods: AuthMethodsResult!
                    ssoProviders: [SsoProviderInfo!]!
                }

                type SsoProviderInfo {
                    name: String!
                    providerKey: String!
                    protocol: String!
                    baseUrl: String!
                    authorizeUrl: String
                    clientId: String!
                    scopes: [String!]!
                    channelCode: String
                }

                type SsoBindResult {
                    bound: Boolean!
                    userId: ID!
                    identifier: String
                    reason: String
                }
                extend type Mutation {
                    bindSsoIdentity(providerKey: String!, code: String!, redirectUri: String): SsoBindResult!
                }

                type DomainResolveResult {
                    token: String!
                    code: String!
                }
                extend type Query {
                    resolveChannelByDomain(host: String!): DomainResolveResult
                }

                type ChannelResolveResult {
                    token: String!
                    code: String!
                    customFields: ChannelResolveCustomFields
                }
                type ChannelResolveCustomFields {
                    shopName: String
                    shopLogo: String
                    billPayStoreImage: String
                    shareImageUrl: String
                    shopIntro: String
                    servicePhone: String
                    shopContent: String
                    displayTemplate: String
                    themeId: String
                }
                extend type Query {
                    resolveChannelByCode(code: String!): ChannelResolveResult
                }

                type ShopChannel {
                    code: String!
                    token: String
                    name: String
                    tenantNo: Int
                    isOfficial: Boolean!
                    isDefault: Boolean!
                }
                extend type Query {
                    shopChannels: [ShopChannel!]!
                }

                type DistrictNode {
                    adcode: String!
                    name: String!
                    level: String!
                    center: LatLng!
                }

                type ReverseGeocodeResult {
                    province: String
                    city: String
                    district: String
                    street: String
                    formattedAddress: String!
                }

                type LatLng {
                    lat: Float!
                    lng: Float!
                }

                type MapSdkConfig {
                    provider: String!
                    sdkUrl: String!
                    hasConfigured: Boolean!
                }

                extend type Query {
                    mapDistricts(parentAdcode: String): [DistrictNode!]!
                    reverseGeocode(lat: Float!, lng: Float!): ReverseGeocodeResult!
                    mapSdkConfig: MapSdkConfig!
                }

                type EligibleShippingMethod {
                    id: ID!
                    code: String!
                    mode: String
                    pickupLocationIds: [ID!]
                    name: String
                }

                type EligiblePaymentMethod {
                    id: ID!
                    code: String!
                    mode: String
                    options: JSON
                    name: String
                }

                extend type Query {
                    eligibleShippingMethodsByProfile(profileIds: [ID!]!): [ShippingMethod!]!
                    eligiblePaymentMethodsByProfile(profileIds: [ID!]!): [PaymentMethod!]!
                    eligibleInstallmentOptions(profileIds: [ID!]!): JSON
                    checkShippingProfileCompatibility(profileIds: [ID!]!): ProfileCompatibilityResult!
                    checkPaymentProfileCompatibility(profileIds: [ID!]!): ProfileCompatibilityResult!
                    eligiblePickupLocationsByProfile(profileIds: [ID!]!): [PickupLocation!]!
                    checkPickupLocationConstraint(profileIds: [ID!]!): Boolean!
                    eligibleShippingMethodsWithConfig(profileIds: [ID!]!): [EligibleShippingMethod!]!
                    resolveShippingMethodsForChannel: [EligibleShippingMethod!]!
                    eligiblePaymentMethodsWithConfig(profileIds: [ID!]!): [EligiblePaymentMethod!]!
                    resolvePaymentMethodsForChannel: [EligiblePaymentMethod!]!
                }

                type ProfileCompatibilityResult {
                    compatible: Boolean!
                    intersectedCount: Int!
                }

                type OrderBox {
                    boxKey: String!
                    profileId: ID
                    profileName: String!
                    lineIds: [ID!]!
                    tenantChannelId: ID
                    shippingProfileIds: [ID!]!
                    availableShippingMethodIds: [ID!]!
                    defaultShippingMethodId: ID
                    pickupLocations: [PickupLocation!]!
                    availablePaymentMethodCodes: [String!]!
                    loginRequiredPaymentCodes: [String!]!
                    requiresAddress: Boolean!
                    requiresContact: Boolean!
                    type: String!
                    availableShippingMethods: [ShippingMethodBrief!]!
                    tenantName: String!
                    lines: [OrderBoxLine!]!
                    availableCoupons: [BoxCouponInfo!]!
                    shippingCost: Int!
                    shippingDiscount: Int!
                    subtotal: Int!
                }

                type OrderBoxLine {
                    orderLineId: ID!
                    productVariantId: ID!
                    productName: String!
                    unitPrice: Int!
                    quantity: Int!
                    lineTotal: Int!
                    featureAssetSource: String
                    variantName: String
                    sku: String
                    isHotel: Boolean!
                    hotelCheckIn: String
                    hotelCheckOut: String
                    hotelNights: Int
                    hotelNightly: [HotelNightPrice!]
                    productSlug: String
                }

                type HotelNightPrice {
                    date: String!
                    priceCent: Int!
                    type: String!
                }

                type BoxCouponInfo {
                    code: String!
                    name: String!
                    condition: String!
                    amount: Int!
                }

                type ShippingMethodBrief {
                    id: ID!
                    code: String!
                    name: String!
                }

                type MerchantSplit {
                    tenantChannelId: ID!
                    tenantName: String!
                    amount: Int!
                }

                extend type Query {
                    orderBoxes: [OrderBox!]!
                    orderMerchantSplit: [MerchantSplit!]!
                }

                extend type Mutation {
                    setOrderBoxShippingMethod(boxKey: String!, shippingMethodId: ID!, pickupLocationId: ID): Order!
                    # 一次性拆单结算：内部完成拆单 + 逐单过渡 ArrangingPayment + addPaymentToOrder，
                    # 返回已结算订单列表。metadata 为支付方式透传 json 字符串。
                    # boxKeys/lineIds 可选：限定只结算部分箱 / 箱内部分行；未传则结算全部箱与行，
                    # 未选中的行回流购物车留在源活动订单。
                    checkoutSplitted(
                        method: String!
                        metadata: String
                        boxKeys: [String!]
                        lineIds: [String!]
                    ): [Order!]!
                }

                # ===== 全局共享余额钱包 =====
                extend type Query {
                    walletBalance: Int!
                }

                # ===== 虚拟×物理库存 =====
                type VariantStockDetail {
                    locationId: ID!
                    name: String!
                    lat: Float
                    lng: Float
                    onHand: Int!
                    distanceKm: Float
                }

                type VariantStockInfo {
                    variantId: ID!
                    saleableStock: Int!
                    physicalStockEnabled: Boolean!
                    stockDetail: [VariantStockDetail!]!
                }

                extend type Query {
                    variantStockInfo(variantId: ID!, lat: Float, lng: Float, city: String, deliveryMethod: String): VariantStockInfo!
                }

                # ===== 配送能力派生（唯一真源：配送档案 mode） =====
                type ChannelDeliveryCapability {
                    modes: [String!]!
                    bothSupported: Boolean!
                    source: String!
                    facetValueIds: JSON
                }
                type VariantDeliveryModes {
                    variantId: ID!
                    modes: [String!]!
                }
                extend type Query {
                    channelDeliveryCapability: ChannelDeliveryCapability!
                    variantDeliveryModes(variantIds: [ID!]!): [VariantDeliveryModes!]!
                }

                # ===== 库区/库位（C 端只读，三档差异由前端门控） =====
                type StorageZone implements Node {
                    id: ID!
                    code: String!
                    name: String!
                    sortOrder: Int!
                    enabled: Boolean!
                }

                extend type Query {
                    variantBin(variantId: ID!, stockLocationId: ID!): JSON
                    storageZones(stockLocationId: ID!): [StorageZone!]!
                }

                # ===== C 端资产上传（售后凭证等，F-VS-09） =====
                # 走 GraphQL multipart 上传，返回的 Asset 由 AssetInterceptorPlugin 转为绝对 URL
                extend type Mutation {
                    uploadCustomerAsset(file: Upload!): Asset!
                }

                # ===== C 端商品变体上架状态 =====
                # Vendure 默认 shop SDL 的 ProductVariant 不含 enabled（仅 admin-api 有该字段），
                # 导致 C 端购物车拿到 activeOrder 后无法判定「商品已下架」的行。
                # 直读实体列 ProductVariant.enabled，走 GraphQL 默认 fieldResolver，无需自定义 resolver。
                extend type ProductVariant {
                    enabled: Boolean!
                }

                # ===== C 端「我的订单」列表 =====
                # OrderList / OrderListOptions 已由 core 在 shop schema 中生成
                # （Customer.orders(options: OrderListOptions): OrderList!），此处仅扩展 Query 字段，勿重复定义类型。
                extend type Query {
                    myOrders(options: OrderListOptions): OrderList!
                }

                # ===== C 端「取消订单」 =====
                # core 的 cancelOrder 仅在 admin-api（shop-api 无同名 mutation），此处补齐顾客自助取消：
                # 仅本人 + 未支付/未履约状态，服务层做归属与状态校验并释放库存分配。
                extend type Mutation {
                    cancelMyOrder(orderId: ID!): Order!
                }

                # ===== 酒店房态查询（C 端日历/DateBar 余量展示） =====
                type HotelAvailabilityDay {
                    "YYYY-MM-DD"
                    date: String!
                    "当晚单价（分）；不含连住折扣"
                    priceCent: Int!
                    "weekday | weekend | holiday | custom"
                    dayType: String!
                    "剩余可订间数；null = 不限房"
                    remaining: Int
                    "关房（不可订）"
                    closed: Boolean!
                }

                extend type Query {
                    "逐晚房态与报价，[from, to] 含两端"
                    hotelAvailability(variantId: ID!, from: String!, to: String!): [HotelAvailabilityDay!]!
                }

                # ===== 酒店房价方案（C 端方案 chips） =====
                type HotelRatePlanPublic {
                    id: ID!
                    code: String!
                    "展示名（纯文本或 LocalizedText JSON 字符串）"
                    name: String!
                    "discount | fixed | surcharge"
                    adjustType: String!
                    "discount 千分比（900=×0.9）；fixed/surcharge 分"
                    adjustValue: Int!
                    "会员等级门槛（数字字符串，达到该等级及以上可见）；null = 全员"
                    memberOnly: String
                    "日均价预估（变体基准价套用单晚方案价，分）；精确逐晚价由 C 端按入住区间重算"
                    avgNightlyEstimateCent: Int!
                }

                extend type Query {
                    "可见房价方案（enabled + 会员过滤 + 售卖期过滤）；checkIn 传入住日时额外过滤售卖期"
                    hotelRatePlans(variantId: ID!, checkIn: String): [HotelRatePlanPublic!]!
                }

                # ===== 酒店预订单（C 端预订卡） =====
                type HotelBookingPublic {
                    id: ID!
                    "订单号（关联订单）"
                    orderCode: String
                    productVariantId: ID!
                    "YYYY-MM-DD"
                    checkIn: String!
                    "YYYY-MM-DD"
                    checkOut: String!
                    nights: Int!
                    roomCount: Int!
                    "pendingDeposit | confirmed | checkedIn | completed | cancelled | noShow"
                    status: String!
                    ratePlanCode: String
                    "成交总额（分，订单行实付口径）"
                    totalCent: Int!
                    guestName: String
                    guestPhone: String
                    "8 位数字入住码（确认后才有；核销凭码）"
                    bookingCode: String
                    "免费取消截止点（确认时固化；null = 无免费取消窗口）"
                    cancelDeadlineAt: DateTime
                    cancelledAt: DateTime
                    cancelReason: String
                    "实际扣款快照（分；0=免费取消/未付款，null=未取消）"
                    cancelFeeCent: Int
                    "关联退款售后单 id（非空=取消退款流程在途或已完成）"
                    afterSalesRequestId: ID
                    "已使用改期次数（每单 V1 限改 1 次）"
                    rescheduleCount: Int!
                    "最近改期时间"
                    rescheduledAt: DateTime
                    "是否有在途改期补差价支付"
                    reschedulePending: Boolean!
                    createdAt: DateTime!
                }

                """
                取消报价（C 端取消按钮前置确认弹层）：
                mode = free（窗口内全额退）| partial（逾时扣首晚退余款）| forfeit（扣全款不退）
                     | unpaid（未付款直接取消）| blocked（无政策，引导联系酒店）
                """
                type HotelCancelQuote {
                    bookingId: ID!
                    mode: String!
                    free: Boolean!
                    cancellable: Boolean!
                    "应退金额（分）"
                    refundCent: Int!
                    "扣款金额（分）"
                    feeCent: Int!
                    "成交总额（分）"
                    totalCent: Int!
                    "已结算实付（分）"
                    paidCent: Int!
                    "首晚房费（全部房间合计，分）"
                    firstNightFeeCent: Int!
                    "免费取消截止点"
                    deadline: DateTime
                }

                type HotelRescheduleNight {
                    "YYYY-MM-DD（入住当晚口径）"
                    date: String!
                    "原始余量（null=不限房，已含本单旧锁）"
                    remaining: Int
                    closed: Boolean!
                    "扣除本单旧段自身锁后是否可住"
                    feasible: Boolean!
                }

                """
                改期报价（C 端改期弹层）：eligible=false 时 reason 给出拦截码
                （notConfirmed/limitReached/sameDates/invalidDates/advanceDays/tooShort/tooLong/soldOut/pricingError）；
                diffCent 正=补差，负=退差。
                """
                type HotelRescheduleQuote {
                    bookingId: ID!
                    eligible: Boolean!
                    reason: String
                    message: String
                    oldCheckIn: String!
                    oldCheckOut: String!
                    newCheckIn: String!
                    newCheckOut: String!
                    nights: Int!
                    oldTotalCent: Int!
                    newTotalCent: Int
                    diffCent: Int
                    refundCent: Int
                    supplementCent: Int
                    availability: [HotelRescheduleNight!]!
                }

                """
                改期提交结果：
                applied=true 已完成（等价/退差/补差即时到账）；
                applied=false=补差异步支付在途，paymentState/paymentId/paymentPublic 供前端拉起支付，
                支付成功后服务端事件自动收口，前端轮询 myHotelBookings 即可。
                """
                type HotelRescheduleResult {
                    booking: HotelBookingPublic!
                    applied: Boolean!
                    paymentState: String
                    paymentId: ID
                    supplementCent: Int!
                    "支付透传参数 JSON 字符串（如微信 payUrl/payType；无则 null）"
                    paymentPublic: String
                }

                extend type Query {
                    "当前登录顾客的酒店预订单（按订单归属隔离，id 倒序，上限 200）；status 可选过滤"
                    myHotelBookings(status: String): [HotelBookingPublic!]!
                    "取消报价（归属隔离；非可取消状态抛错）"
                    hotelBookingCancelQuote(id: ID!): HotelCancelQuote!
                    "改期报价（归属隔离；checkIn/checkOut 为期望新日期 YYYY-MM-DD）"
                    hotelBookingRescheduleQuote(id: ID!, checkIn: String!, checkOut: String!): HotelRescheduleQuote!
                }

                extend type Mutation {
                    """
                    顾客自助取消预订（归属隔离）：
                    unpaid/forfeit 立即取消；free 自动全额退款后取消；partial 建售后单待商家审批（预订保留至退款完成）；blocked 拒绝。
                    """
                    cancelMyHotelBooking(id: ID!, reason: String): HotelBookingPublic!
                    """
                    顾客自助改期（归属隔离；confirmed 且每单限 1 次）：
                    等价/退差直接完成（退差自动退回原支付渠道）；补差需传 paymentMethod，
                    即时结算支付方式直接完成，异步支付返回在途结果待支付回调收口。
                    """
                    rescheduleMyHotelBooking(id: ID!, checkIn: String!, checkOut: String!, paymentMethod: String): HotelRescheduleResult!
                    "放弃在途改期补差（取消补差支付并清空意向）"
                    cancelMyRescheduleSupplement(id: ID!): HotelBookingPublic!
                }

                ${redemptionShopSchema}
            `;
        },
        resolvers: [PickupLocationShopResolver, PickupShopResolver, AuthShopResolver, DomainShopResolver, MapShopResolver, ShippingProfileShopResolver, DeliveryCapabilityResolver, PaymentProfileShopResolver, OrderBoxShopResolver, OrderSplitShopResolver, WalletShopResolver, RedemptionShopResolver, InventoryShopResolver, StorageBinShopResolver, CustomerAssetShopResolver, MyOrdersShopResolver, HotelInventoryShopResolver, HotelRatePlanShopResolver, HotelBookingShopResolver],
    },
    configuration: config => {
        // 注入 authSecret 到 crypto 模块（configuration 在 bootstrap 早期执行，此时 options 已可用）
        setAuthSecret(CjkPlugin.options.authSecret);

        // 租户级税率方式（三态 taxMode：inclusive 含税价含拆税 / zero 零税价净价结算 / exclusive 不含税价价税分离）。
        // resolveTaxMode 兼容旧 taxEnabled（true→inclusive，false→zero），存量租户行为不回退。
        config.taxOptions = config.taxOptions || {};
        config.taxOptions.taxLineCalculationStrategy = new ChannelTaxLineCalculationStrategy();

        // 注册 SSO 策略到 shop 端（init 钩子由 Vendure 自动调用）
        config.authOptions = config.authOptions || {};
        config.authOptions.shopAuthenticationStrategy = [
            ...(config.authOptions.shopAuthenticationStrategy || []),
            ssoAuthenticationStrategy, // 使用单例：resolver 经 export 访问 bindIdentityToUser
        ];

        if (CjkPlugin.options.cod?.enabled) {
            config.paymentOptions.paymentMethodHandlers = [
                ...(config.paymentOptions.paymentMethodHandlers || []),
                codPaymentHandler,
            ];
        }

        // 聚合码支付（线下扫码 + 自确认），默认启用
        if (CjkPlugin.options.aggregate?.enabled !== false) {
            config.paymentOptions.paymentMethodHandlers = [
                ...(config.paymentOptions.paymentMethodHandlers || []),
                aggregatePaymentHandler,
            ];
        }

        // 固定聚合码收款（门店到店收银，自确认），默认启用
        if (CjkPlugin.options.aggregate?.enabled !== false) {
            config.paymentOptions.paymentMethodHandlers = [
                ...(config.paymentOptions.paymentMethodHandlers || []),
                fixedAggregateCollectionHandler,
            ];
        }

        // 全局共享余额钱包支付（跨租户/跨档案合单），默认启用
        config.paymentOptions.paymentMethodHandlers = [
            ...(config.paymentOptions.paymentMethodHandlers || []),
            balanceWalletPaymentHandler,
        ];

        const hasPickup = CjkPlugin.options.storePickup?.enabled
            || CjkPlugin.options.pickupPoint?.enabled
            || CjkPlugin.options.employeePickup?.enabled;
        if (hasPickup) {
            config.shippingOptions = config.shippingOptions || {};
            config.shippingOptions.shippingEligibilityCheckers = [
                ...(config.shippingOptions.shippingEligibilityCheckers || []),
            ];
            config.shippingOptions.shippingCalculators = [
                ...(config.shippingOptions.shippingCalculators || []),
            ];
            config.shippingOptions.fulfillmentHandlers = [
                ...(config.shippingOptions.fulfillmentHandlers || []),
            ];

            if (CjkPlugin.options.storePickup?.enabled) {
                config.shippingOptions.shippingEligibilityCheckers!.push(storePickupEligibilityChecker);
                config.shippingOptions.shippingCalculators!.push(storePickupCalculator);
                config.shippingOptions.fulfillmentHandlers!.push(storePickupFulfillmentHandler);
            }

            if (CjkPlugin.options.pickupPoint?.enabled) {
                config.shippingOptions.shippingEligibilityCheckers!.push(pickupPointEligibilityChecker);
                config.shippingOptions.shippingCalculators!.push(pickupPointCalculator);
                config.shippingOptions.fulfillmentHandlers!.push(pickupPointFulfillmentHandler);
            }

            if (CjkPlugin.options.employeePickup?.enabled) {
                config.shippingOptions.shippingEligibilityCheckers!.push(employeePickupEligibilityChecker);
                config.shippingOptions.shippingCalculators!.push(employeePickupCalculator);
                config.shippingOptions.fulfillmentHandlers!.push(employeePickupFulfillmentHandler);
            }
        }

        // 阶梯重量/件数计费（始终注册，供快递配送方式使用）
        config.shippingOptions = config.shippingOptions || {};
        config.shippingOptions.shippingEligibilityCheckers = [
            ...(config.shippingOptions.shippingEligibilityCheckers || []),
            tieredShippingEligibilityChecker,
        ];
        config.shippingOptions.shippingCalculators = [
            ...(config.shippingOptions.shippingCalculators || []),
            tieredWeightShippingCalculator,
            tieredQuantityShippingCalculator,
            localDeliveryCalculator,
        ];

        // 按配送档案分箱：多配送方式时每个 ShippingLine 只挂其箱内 OrderLine，
        // 支撑「单订单内多配送组 / 多 fulfillment」。单箱场景退化为默认全量分配。
        config.shippingOptions.shippingLineAssignmentStrategy = new BoxShippingLineAssignmentStrategy();

        if (CjkPlugin.options.promotionPolicy?.enabled) {
            config.promotionOptions = config.promotionOptions || {};
            config.promotionOptions.promotionConditions = [
                ...(config.promotionOptions.promotionConditions || []),
                couponStackableCondition,
            ];

            config.customFields = {
                ...config.customFields,
                Promotion: [
                    ...(config.customFields?.Promotion || []),
                    ...promotionCustomFields.Promotion!,
                ],
            };
        }

        if (CjkPlugin.options.tenant?.enabled) {
            // 合并租户 Channel 自定义字段，按 name 去重：dev-config 或其它插件已定义的同名字段以既有为准
            // （与下方 ProductVariant 合并去重、ShopPlugin.mergeCustomFields 保持一致，避免复制 app 崩溃报 duplicated custom field）。
            const existingChannelNames = (config.customFields?.Channel || []).map(f => f.name);
            const newChannelFields = [
                ...(tenantChannelCustomFields.Channel || []),
                ...inventoryModeChannelFields,
            ].filter(f => !existingChannelNames.includes(f.name));
            if (newChannelFields.length > 0) {
                config.customFields = {
                    ...config.customFields,
                    Channel: [
                        ...(config.customFields?.Channel || []),
                        ...newChannelFields,
                    ],
                };
            }
        }

        // 注册商品类型 customFields（实体/虚拟/服务；按 name 去重，dev-config 已定义的同名字段以既有为准）
        config.customFields = {
            ...config.customFields,
            Product: [
                ...(config.customFields?.Product || []),
                ...(productTypeCustomFields.Product || []).filter(
                    f => !(config.customFields?.Product || []).some(e => e.name === f.name),
                ),
            ],
        };

        // 注册 Order customFields（selectedPickupLocationId、pickupType）
        config.customFields = {
            ...config.customFields,
            Order: [
                ...(config.customFields?.Order || []),
                ...orderCustomFields.Order!,
            ],
        };

        // 注册 Channel customFields（后台改价幅度上限）—— 去重防止重复注册
        {
            const existingChannelNames = (config.customFields?.Channel || []).map(f => f.name);
            const newChannelFields = (orderPriceChannelCustomFields.Channel || []).filter(
                f => !existingChannelNames.includes(f.name),
            );
            if (newChannelFields.length > 0) {
                config.customFields = {
                    ...config.customFields,
                    Channel: [
                        ...(config.customFields?.Channel || []),
                        ...newChannelFields,
                    ],
                };
            }
        }

        config.customFields = {
            ...config.customFields,
            Customer: [
                ...(config.customFields?.Customer || []),
                ...customerCustomFields.Customer!,
            ],
        };

        // 注册 ProductVariant customFields（weight/dimensions）—— 去重防止重复注册
        {
            const existingPvFields = (config.customFields?.ProductVariant || []).map(f => f.name);
            const newPvFields = (productVariantCustomFields.ProductVariant || []).filter(
                f => !existingPvFields.includes(f.name),
            );
            if (newPvFields.length > 0) {
                config.customFields = {
                    ...config.customFields,
                    ProductVariant: [
                        ...(config.customFields?.ProductVariant || []),
                        ...newPvFields,
                    ],
                };
            }
        }

        // 注册 ProductVariant customFields（hotelRoomConfig）—— 与上方 weight/dimensions 同款去重
        {
            const existingHotelPvFields = (config.customFields?.ProductVariant || []).map(f => f.name);
            const newHotelPvFields = (hotelRoomCustomFields.ProductVariant || []).filter(
                f => !existingHotelPvFields.includes(f.name),
            );
            if (newHotelPvFields.length > 0) {
                config.customFields = {
                    ...config.customFields,
                    ProductVariant: [...(config.customFields?.ProductVariant || []), ...newHotelPvFields],
                };
            }
        }

        // 注册 OrderLine customFields（酒店入住日期/晚数）—— 去重防止重复注册
        {
            const existingHotelOlFields = (config.customFields?.OrderLine || []).map(f => f.name);
            const newHotelOlFields = (hotelOrderLineCustomFields.OrderLine || []).filter(
                f => !existingHotelOlFields.includes(f.name),
            );
            if (newHotelOlFields.length > 0) {
                config.customFields = {
                    ...config.customFields,
                    OrderLine: [...(config.customFields?.OrderLine || []), ...newHotelOlFields],
                };
            }
        }

        // 注册 ShippingMethod customFields（enabled 启停）—— 去重防止重复注册
        {
            const existingSmFields = (config.customFields?.ShippingMethod || []).map(f => f.name);
            const newSmFields = (customShippingMethodFields.ShippingMethod || []).filter(
                f => !existingSmFields.includes(f.name),
            );
            if (newSmFields.length > 0) {
                config.customFields = {
                    ...config.customFields,
                    ShippingMethod: [
                        ...(config.customFields?.ShippingMethod || []),
                        ...newSmFields,
                    ],
                };
            }
        }

        // 注册 Asset customFields（uploadedBy 记录上传者，供图库按用户过滤）—— 去重防止重复注册
        {
            const existingAssetFields = (config.customFields?.Asset || []).map(f => f.name);
            const newAssetFields = (assetCustomFields.Asset || []).filter(
                f => !existingAssetFields.includes(f.name),
            );
            if (newAssetFields.length > 0) {
                config.customFields = {
                    ...config.customFields,
                    Asset: [
                        ...(config.customFields?.Asset || []),
                        ...newAssetFields,
                    ],
                };
            }
        }

        // 注册 StockLocation customFields（kind/code）—— 去重防止重复注册
        {
            const existingSlFields = (config.customFields?.StockLocation || []).map(f => f.name);
            const newSlFields = (stockLocationCustomFields.StockLocation || []).filter(
                f => !existingSlFields.includes(f.name),
            );
            if (newSlFields.length > 0) {
                config.customFields = {
                    ...config.customFields,
                    StockLocation: [
                        ...(config.customFields?.StockLocation || []),
                        ...newSlFields,
                    ],
                };
            }
        }

        // 注册 Collection customFields（icon 分类图标）—— 去重防止重复注册
        {
            const existingCollectionFields = (config.customFields?.Collection || []).map(f => f.name);
            const newCollectionFields = [
                {
                    name: 'icon',
                    type: 'string' as const,
                    label: [
                        { languageCode: LanguageCode.zh_Hans, value: '分类图标' },
                        { languageCode: LanguageCode.en, value: 'Category icon' },
                    ],
                    nullable: true,
                    public: true,
                },
            ].filter(f => !existingCollectionFields.includes(f.name));
            if (newCollectionFields.length > 0) {
                config.customFields = {
                    ...config.customFields,
                    Collection: [
                        ...(config.customFields?.Collection || []),
                        ...newCollectionFields,
                    ],
                };
            }
        }

        // 注册自定义权限（PickupPermissions）
        config.authOptions = config.authOptions || {};
        config.authOptions.customPermissions = [
            ...(config.authOptions.customPermissions || []),
            ...pickupPermissionDefinitions,
        ];

        // 注册 PickupLocation 全局归属权限（SetGlobalPickupLocation）
        config.authOptions.customPermissions = [
            ...(config.authOptions.customPermissions || []),
            ...pickupLocationPermissionDefinitions,
        ];

        config.authOptions.customPermissions = [
            ...(config.authOptions.customPermissions || []),
            tenantConfigPermission,
        ];

        // 注册 ShippingTemplate 权限
        config.authOptions.customPermissions = [
            ...(config.authOptions.customPermissions || []),
            ...shippingTemplatePermissionDefinitions,
        ];

        // 注册 ShippingProfile 权限
        config.authOptions.customPermissions = [
            ...(config.authOptions.customPermissions || []),
            ...shippingProfilePermissionDefinitions,
        ];

        // 注册 PaymentProfile 权限
        config.authOptions.customPermissions = [
            ...(config.authOptions.customPermissions || []),
            ...paymentProfilePermissionDefinitions,
        ];

        // 注册 PaymentTemplate 权限
        config.authOptions.customPermissions = [
            ...(config.authOptions.customPermissions || []),
            ...paymentTemplatePermissionDefinitions,
        ];

        // 注册租户管理/角色/人员/核销自定义权限
        config.authOptions.customPermissions = [
            ...(config.authOptions.customPermissions || []),
            ...tenantPermissionDefinitions,
        ];

        // 注册多人协同盘库权限（StocktakeCount / StocktakePost）
        config.authOptions.customPermissions = [
            ...(config.authOptions.customPermissions || []),
            ...stocktakePermissionDefinitions,
        ];

        // 注册 Channel customFields（预留单有效期 reservationTtlMinutes）—— 按 name 去重合并
        config.customFields.Channel = mergeCustomFields(config.customFields.Channel, [
            {
                name: 'reservationTtlMinutes',
                // 注意：不能写 'number' —— Vendure 的 getColumnType 白名单只有
                // string/localeString/text/localeText/boolean/int/float/datetime/struct，
                // 非白名单值会在 preBootstrapConfig 里 assertNever 抛错导致服务起不来。
                type: 'int',
                label: [{ languageCode: LanguageCode.zh_Hans, value: '预留单有效期（分钟）' }],
                description: [
                    {
                        languageCode: LanguageCode.zh_Hans,
                        value: '预留单超时自动释放时长，默认 30；仅对未完成备货拆分的预留单生效',
                    },
                ],
            } as any,
        ]);

        // 注册预留单超时释放 ScheduledTask（由 DefaultSchedulerPlugin 在 worker 上周期执行）
        if (!config.schedulerOptions) {
            config.schedulerOptions = { tasks: [] } as any;
        }
        if (!config.schedulerOptions.tasks) {
            config.schedulerOptions.tasks = [];
        }
        if (!config.schedulerOptions.tasks.some(t => t.id === RELEASE_EXPIRED_RESERVATIONS_TASK_ID)) {
            config.schedulerOptions.tasks.push(releaseExpiredReservationsTask);
        }
        // 注册过期锁房单释放 ScheduledTask（每小时；hold 统计口径已排除过期，此任务收敛状态与审计）
        if (!config.schedulerOptions.tasks.some(t => t.id === RELEASE_EXPIRED_HOTEL_HOLDS_TASK_ID)) {
            config.schedulerOptions.tasks.push(releaseExpiredHotelHoldsTask);
        }
        // 注册酒店预订日常流转 ScheduledTask（每日：离店日 completed、过离店日未入住 noShow）
        if (!config.schedulerOptions.tasks.some(t => t.id === HOTEL_BOOKING_DAILY_TRANSITION_TASK_ID)) {
            config.schedulerOptions.tasks.push(hotelBookingDailyTransitionTask);
        }

        // 注册订单行单价策略：酒店房型按入离日期逐晚计价，其它变体直通默认价
        config.orderOptions = {
            ...(config.orderOptions ?? {}),
            orderItemPriceCalculationStrategy: new HotelOrderItemPriceCalculationStrategy(),
        } as any;
        // 注册酒店防超订拦截器（幂等：configuration 可能被调用多次）
        if (!Array.isArray(config.orderOptions.orderInterceptors)) {
            (config.orderOptions as any).orderInterceptors = [];
        }
        if (!config.orderOptions.orderInterceptors.some(i => i instanceof HotelOrderInterceptor)) {
            config.orderOptions.orderInterceptors.push(new HotelOrderInterceptor());
        }

        return config;
    },
    dashboard: '../dashboard/index.tsx',
    compatibility: '^3.0.0',
})
export class CjkPlugin implements OnApplicationBootstrap, NestModule {
    private static options: CjkPluginOptions;

    constructor(
        @Inject(CJK_PLUGIN_OPTIONS) private options: CjkPluginOptions,
        private moduleRef: ModuleRef,
    ) {}

    static init(options: CjkPluginOptions): Type<CjkPlugin> {
        CjkPlugin.options = options;
        return CjkPlugin;
    }

    async onApplicationBootstrap(): Promise<void> {
        const injector = new Injector(this.moduleRef);

        // 注入全局共享余额钱包服务到支付 handler（与现有一致：支付处理器经静态 setter 接收服务）
        setWalletService(injector.get(WalletService));

        // 幂等补种默认房型模板（不覆盖客户改动；删除过的 code 不补回）
        if (this.options.seedDefaultData !== false) {
            const rtService = injector.get(RoomTemplateService);
            await rtService.seedDefaultTemplates();
        }

        // 虚拟×物理库存：SALE 同事务镜像虚拟仓（物理驱动变体）
        injector.get(VirtualPhysicalStockService).registerMirrorHandler();

        // 多仓拆分发货预留单：ALLOCATION/SALE/CANCELLATION/RELEASE 事件接线（下单/发货/取消）
        injector.get(StockReservationService).registerOrderHandlers();

        // 到店核销范围：把本插件的判定实现注册给 coupon-plugin（依赖方向 cjk → coupon，避免成环）
        setRedeemScopeResolver(injector.get(RedeemScopeService));

        // 幂等创建默认配送/支付数据（自提点、门店自提配送档案、门店收银支付档案）
        if (this.options.seedDefaultData !== false && this.options.profiles?.enabled !== false) {
            const seedService = injector.get(DefaultDataService);
            await seedService.seed();
        }

        if (this.options.i18n?.enabled !== false) {
            const i18nService = injector.get(I18nService);
            const languages = this.options.i18n?.languages || ['zh_Hans', 'zh_Hant', 'ja', 'ko'];
            const translations: Record<string, any> = {
                zh_Hans: require('./i18n/zh_CN.json'),
                zh_Hant: require('./i18n/zh_TW.json'),
                ja: require('./i18n/ja.json'),
                ko: require('./i18n/ko.json'),
            };
            for (const lang of languages) {
                if (translations[lang]) {
                    i18nService.addTranslation(lang, translations[lang]);
                    Logger.info(`Registered i18n translation for ${lang}`, loggerCtx);
                }
            }
        }

        if (this.options.regions?.enabled !== false) {
            Logger.info('CJK regions module enabled - use RegionPopulator in your server bootstrap to populate countries', loggerCtx);
        }

        if (this.options.cod?.enabled) {
            Logger.info('Cash on Delivery payment module enabled', loggerCtx);
        }

        if (this.options.storePickup?.enabled) {
            Logger.info('Store pickup shipping module enabled', loggerCtx);
        }

        if (this.options.pickupPoint?.enabled) {
            Logger.info('Pickup point shipping module enabled', loggerCtx);
        }

        if (this.options.employeePickup?.enabled) {
            Logger.info('Employee pickup shipping module enabled', loggerCtx);
        }

        if (this.options.promotionPolicy?.enabled) {
            Logger.info('Promotion stacking policy module enabled', loggerCtx);
        }

        if (this.options.tenant?.enabled) {
            Logger.info('Tenant (multi-channel) module enabled', loggerCtx);
        }

        // 存量租户默认角色补种子（幂等，仅补缺失；失败不阻塞启动）
        if (this.options.tenant?.enabled) {
            try {
                await injector.get(TenantMemberService).ensureDefaultRolesForAllChannels(RequestContext.empty());
            } catch (e: any) {
                Logger.warn(`默认角色补种子失败（可后台手动触发 importDefaultRoles）: ${e.message}`, loggerCtx);
            }
        }

        // 超管全局豁免渠道校验：把存量渠道补关联到超管角色（幂等；失败不阻塞启动）
        if (this.options.tenant?.enabled) {
            try {
                const tenantSvc = injector.get(TenantMemberService);
                await tenantSvc.ensureSuperAdminRoleCoversAllChannels(RequestContext.empty());
            } catch (e: any) {
                Logger.warn(`超管角色渠道覆盖（存量）失败: ${e.message}`, loggerCtx);
            }
        }

        // 将来新建渠道自动关联到超管角色，保证超管在新租户内同样全局豁免
        {
            const eventBus = injector.get(EventBus);
            eventBus.ofType(ChannelEvent).subscribe(async (event) => {
                if (event.type !== 'created') return;
                try {
                    await injector
                        .get(TenantMemberService)
                        .ensureSuperAdminRoleCoversChannel(event.ctx, (event.entity as any).id);
                } catch (e: any) {
                    Logger.warn(`新渠道关联超管角色失败: ${e.message}`, loggerCtx);
                }
            });
        }

        // 注册 Profile 事件订阅
        if (this.options.profiles?.enabled !== false) {
            const eventBus = injector.get(EventBus);
            const shippingSvc = injector.get(ShippingProfileService);
            const paymentSvc = injector.get(PaymentProfileService);
            const connection = injector.get(TransactionalConnection);

            // 订单结算时快照 Profile 信息
            eventBus.ofType(OrderEvent).subscribe(async (event) => {
                if (event.type !== 'updated') return;
                const order = event.entity;
                if (order.state !== 'PaymentSettled' && order.state !== 'PaymentAuthorized') return;
                const lines = order.lines ?? [];
                if (lines.length === 0) return;

                try {
                    const shippingProfileNames: Record<string, string> = {};
                    const paymentProfileNames: Record<string, string> = {};

                    for (const line of lines) {
                        const variant = line.productVariant;
                        if (!variant) continue;
                        const spId = (variant as any).customFields?.shippingProfileId;
                        const ppId = (variant as any).customFields?.paymentProfileId;
                        if (spId && !shippingProfileNames[spId]) {
                            const profile = await shippingSvc.findOne(event.ctx, spId as any);
                            shippingProfileNames[spId] = profile?.name ?? spId;
                        }
                        if (ppId && !paymentProfileNames[ppId]) {
                            const profile = await paymentSvc.findOne(event.ctx, ppId as any);
                            paymentProfileNames[ppId] = profile?.name ?? ppId;
                        }
                    }

                    const orderRepo = connection.getRepository(event.ctx, 'Order' as any);
                    await orderRepo.update(order.id, {
                        customFields: {
                            shippingProfileSnapshot: JSON.stringify(shippingProfileNames),
                            paymentProfileSnapshot: JSON.stringify(paymentProfileNames),
                        },
                    } as any);
                } catch (e: any) {
                    Logger.error(`Failed to save profile snapshot: ${e.message}`, loggerCtx);
                }
            });

            // 加购时检测混合 Profile 并记录日志
            eventBus.ofType(OrderEvent).subscribe(async (event) => {
                if (event.type !== 'updated') return;
                const order = event.entity;
                if (order.state !== 'AddingItems') return;
                const lines = order.lines ?? [];
                if (lines.length < 2) return;

                const profileIds = new Set<string>();
                for (const line of lines) {
                    const spId = (line.productVariant as any)?.customFields?.shippingProfileId;
                    if (spId) profileIds.add(spId);
                }
                if (profileIds.size > 1) {
                    Logger.info(
                        `Order ${order.code} has mixed shipping profiles: ${[...profileIds].join(', ')}`,
                        loggerCtx,
                    );
                }
            });
        }

        // 酒店预订单事件联动（P3）：订单进入可处理状态 → 建 pending 预订单；
        // PartiallyPaid（支付计划首期付清）/ PaymentSettled（全清）→ 自动确认（入住码+取消截止点+锁房 booked）
        // 触发源两路：OrderEvent 'updated'（客户/自定义字段更新）+ OrderStateTransitionEvent
        // （支付结算与状态流转只发后者，不发 OrderEvent）；transition 事件上的 order 缺
        // lines/customer 关系，service 内按 id 重取（handleOrderTransition）。ensure 幂等，双路无副作用。
        {
            const eventBus = injector.get(EventBus);
            const bookingService = injector.get(HotelBookingService);
            eventBus.ofType(OrderEvent).subscribe(async (event) => {
                if (event.type !== 'updated') return;
                try {
                    await bookingService.handleOrderUpdated(event.ctx, event.entity);
                } catch (e: any) {
                    Logger.error(`hotel booking event failed: ${e?.message}`, loggerCtx);
                }
            });
            eventBus.ofType(OrderStateTransitionEvent).subscribe(async (event) => {
                try {
                    await bookingService.handleOrderTransition(event.ctx, event.order.id);
                } catch (e: any) {
                    Logger.error(`hotel booking transition event failed: ${e?.message}`, loggerCtx);
                }
            });
            // P4 Task 15：改期补差 Payment Settled → 自动落地改期；Cancelled/Declined/Error → 清在途意向。
            // 非补差支付（metadata 无标记）在 service 内 no-op。
            eventBus.ofType(PaymentStateTransitionEvent).subscribe(async (event) => {
                try {
                    await bookingService.handleReschedulePayment(event);
                } catch (e: any) {
                    Logger.error(`hotel reschedule payment event failed: ${e?.message}`, loggerCtx);
                }
            });
        }

        // P4 Task 14：跨插件注入 AfterSalesService（延迟注入规避模块顺序）；
        // 订阅售后状态机事件：refund_only 退款 Refunded → 预订自动 cancelled + 释放锁房（逾时扣首晚审批收口）。
        // AfterSalesPlugin 未安装的部署降级：注入失败仅告警，顾客侧退款取消将被服务层拒绝。
        try {
            const afterSalesService = injector.get(AfterSalesService);
            const bookingServiceForCancel = injector.get(HotelBookingService);
            bookingServiceForCancel.setAfterSalesService(afterSalesService);
            injector.get(EventBus).ofType(AfterSalesStateTransitionEvent).subscribe(async (event) => {
                try {
                    await bookingServiceForCancel.handleAfterSalesRefunded(event);
                } catch (e: any) {
                    Logger.error(`hotel after-sales refund event failed: ${e?.message}`, loggerCtx);
                }
            });
        } catch (e: any) {
            Logger.warn(
                `AfterSalesService not available, hotel booking refund cancel disabled: ${e?.message}`,
                loggerCtx,
            );
        }

        // 核销码改由 checkoutSplitted（performSplitCheckout）同步 best-effort 生成，并在 C端
        // orderRedemptionCode（ensure 写后重读对账）兜底。原 OrderStateTransitionEvent 异步后台 ensure
        // 会与同步 ensure 并发生成不同码、后写覆盖导致 lookupByCode 查不到（spurious not_found），已移除。

        // 方案2-C 日批：每 5 分钟检查，若当日批未跑则执行（每日 2:00 后首查触发；仅物理库存租户）
        {
            const svc = injector.get(ReconciliationService);
            const channelSvc = injector.get(ChannelService);
            let lastDate = '';
            setInterval(async () => {
                try {
                    const now = new Date();
                    const date = now.toISOString().slice(0, 10);
                    if (date === lastDate) {
                        return;
                    }
                    if (now.getHours() < 2) {
                        return;
                    }
                    const page = await channelSvc.findAll(RequestContext.empty(), { take: 200 } as any);
                    for (const ch of page.items) {
                        const enabled = Boolean((ch.customFields as any)?.physicalStockEnabled);
                        if (!enabled) {
                            continue;
                        }
                        const ctx = new RequestContext({
                            apiType: 'admin',
                            isAuthorized: true,
                            authorizedAsOwnerOnly: false,
                            channel: ch as any,
                            session: undefined as any,
                        });
                        await svc.runBatch(ctx, date, 'cron');
                    }
                    lastDate = date;
                } catch (e: any) {
                    Logger.error(`日批对账失败: ${e?.message}`, 'ReconciliationCron');
                }
            }, 5 * 60 * 1000);
        }
    }

    configure(consumer: MiddlewareConsumer): void {}
}
