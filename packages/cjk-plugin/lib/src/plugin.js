"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var CjkPlugin_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CjkPlugin = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const core_2 = require("@nestjs/core");
const constants_1 = require("./constants");
const cod_handler_1 = require("./payment/cod-handler");
const aggregate_payment_handler_1 = require("./payment/aggregate-payment-handler");
const fixed_aggregate_collection_handler_1 = require("./payment/fixed-aggregate-collection-handler");
const coupon_stackable_condition_1 = require("./promotion/coupon-stackable-condition");
const promotion_custom_fields_1 = require("./promotion/promotion-custom-fields");
const pickup_calculator_1 = require("./pickup/pickup-calculator");
const pickup_eligibility_checker_1 = require("./pickup/pickup-eligibility-checker");
const pickup_fulfillment_handler_1 = require("./pickup/pickup-fulfillment-handler");
const pickup_location_entity_1 = require("./pickup/pickup-location.entity");
const pickup_location_admin_resolver_1 = require("./pickup/pickup-location-admin.resolver");
const pickup_location_shop_resolver_1 = require("./pickup/pickup-location-shop.resolver");
const pickup_shop_resolver_1 = require("./pickup/pickup-shop.resolver");
const pickup_location_service_1 = require("./pickup/pickup-location.service");
const pickup_permissions_1 = require("./pickup/pickup-permissions");
const pickup_location_permissions_1 = require("./pickup/pickup-location-permissions");
const enterprise_customer_entity_1 = require("./pickup/enterprise-customer/enterprise-customer.entity");
const enterprise_customer_service_1 = require("./pickup/enterprise-customer/enterprise-customer.service");
const enterprise_customer_admin_resolver_1 = require("./pickup/enterprise-customer/enterprise-customer-admin.resolver");
const order_custom_fields_1 = require("./order/order-custom-fields");
const order_price_custom_fields_1 = require("./order/order-price-custom-fields");
const order_price_admin_resolver_1 = require("./order/order-price-admin.resolver");
const my_orders_shop_resolver_1 = require("./order/my-orders-shop.resolver");
const customer_custom_fields_1 = require("./customer/customer-custom-fields");
const tenant_channel_custom_fields_1 = require("./tenant/tenant-channel-custom-fields");
const product_custom_fields_1 = require("./product/product-custom-fields");
const product_variant_custom_fields_1 = require("./shipping/product-variant-custom-fields");
const shipping_method_custom_fields_1 = require("./shipping/shipping-method-custom-fields");
const asset_custom_fields_1 = require("./asset/asset-custom-fields");
const asset_library_admin_resolver_1 = require("./asset/asset-library-admin.resolver");
const customer_asset_shop_resolver_1 = require("./asset/customer-asset-shop.resolver");
const tiered_shipping_calculator_1 = require("./shipping/tiered-shipping-calculator");
const tiered_shipping_eligibility_checker_1 = require("./shipping/tiered-shipping-eligibility-checker");
const shipping_template_entity_1 = require("./shipping/shipping-template.entity");
const shipping_template_service_1 = require("./shipping/shipping-template.service");
const shipping_template_admin_resolver_1 = require("./shipping/shipping-template-admin.resolver");
const shipping_template_permissions_1 = require("./shipping/shipping-template-permissions");
const tenant_setup_service_1 = require("./tenant/tenant-setup.service");
const tenant_member_entity_1 = require("./tenant/tenant-member.entity");
const tenant_permissions_1 = require("./tenant/tenant-permissions");
const tenant_member_service_1 = require("./tenant/tenant-member.service");
const redeem_scope_service_1 = require("./tenant/redeem-scope.service");
const tenant_admin_resolver_1 = require("./tenant/tenant-admin.resolver");
const tenant_member_resolver_1 = require("./tenant/tenant-member.resolver");
const my_access_resolver_1 = require("./tenant/my-access.resolver");
const auth_shop_resolver_1 = require("./auth/auth-shop.resolver");
const auth_admin_resolver_1 = require("./auth/auth-admin.resolver");
const auth_method_guard_1 = require("./auth/auth-method-guard");
const tenant_enabled_guard_1 = require("./auth/tenant-enabled.guard");
const sso_authentication_strategy_1 = require("./auth/sso-authentication-strategy");
const crypto_1 = require("./auth/crypto");
const domain_resolver_service_1 = require("./tenant/domain-resolver.service");
const domain_shop_resolver_1 = require("./tenant/domain-shop.resolver");
const map_provider_registry_1 = require("./map/map-provider-registry");
const map_service_1 = require("./map/map.service");
const map_admin_resolver_1 = require("./map/map-admin.resolver");
const map_shop_resolver_1 = require("./map/map-shop.resolver");
const migrations_1 = require("./migrations");
const coupon_plugin_1 = require("@vendure/coupon-plugin");
const auth_config_service_1 = require("./auth/auth-config.service");
const pay_config_service_1 = require("./payment/pay-config.service");
const map_config_service_1 = require("./map/map-config.service");
const sso_provider_service_1 = require("./auth/sso-provider.service");
const invite_code_service_1 = require("./auth/invite-code.service");
const basic_config_service_1 = require("./tenant/basic-config.service");
const channel_provisioning_service_1 = require("./tenant/channel-provisioning.service");
const service_notify_config_service_1 = require("./tenant/service-notify-config.service");
const multi_language_config_service_1 = require("./tenant/multi-language-config.service");
const tenant_config_permissions_1 = require("./admin/tenant-config-permissions");
const tenant_config_admin_resolver_1 = require("./admin/tenant-config-admin.resolver");
const shipping_profile_entity_1 = require("./shipping/shipping-profile.entity");
const shipping_profile_method_entity_1 = require("./shipping/shipping-profile-method.entity");
const shipping_profile_service_1 = require("./shipping/shipping-profile.service");
const delivery_facet_service_1 = require("./shipping/delivery-facet.service");
const shipping_profile_admin_resolver_1 = require("./shipping/shipping-profile-admin.resolver");
const shipping_profile_permissions_1 = require("./shipping/shipping-profile-permissions");
const payment_profile_entity_1 = require("./payment/payment-profile.entity");
const payment_profile_method_entity_1 = require("./payment/payment-profile-method.entity");
const payment_profile_service_1 = require("./payment/payment-profile.service");
const payment_profile_admin_resolver_1 = require("./payment/payment-profile-admin.resolver");
const payment_profile_permissions_1 = require("./payment/payment-profile-permissions");
const payment_template_entity_1 = require("./payment/payment-template.entity");
const payment_template_service_1 = require("./payment/payment-template.service");
const payment_template_admin_resolver_1 = require("./payment/payment-template-admin.resolver");
const payment_template_permissions_1 = require("./payment/payment-template-permissions");
const room_template_entity_1 = require("./hotel/room-template.entity");
const room_template_control_entity_1 = require("./hotel/room-template-control.entity");
const room_template_service_1 = require("./hotel/room-template.service");
const room_template_admin_resolver_1 = require("./hotel/room-template-admin.resolver");
const room_day_entity_1 = require("./hotel/booking/room-day.entity");
const booking_lock_entity_1 = require("./hotel/booking/booking-lock.entity");
const rate_plan_entity_1 = require("./hotel/booking/rate-plan.entity");
const booking_entity_1 = require("./hotel/booking/booking.entity");
const hotel_inventory_service_1 = require("./hotel/booking/hotel-inventory.service");
const rate_plan_service_1 = require("./hotel/booking/rate-plan.service");
const booking_service_1 = require("./hotel/booking/booking.service");
const hotel_order_interceptor_1 = require("./hotel/booking/hotel-order-interceptor");
const release_expired_holds_task_1 = require("./hotel/booking/release-expired-holds.task");
const booking_daily_transition_task_1 = require("./hotel/booking/booking-daily-transition.task");
const hotel_custom_fields_1 = require("./hotel/hotel-custom-fields");
const hotel_order_line_custom_fields_1 = require("./hotel/hotel-order-line-custom-fields");
const hotel_order_item_price_strategy_1 = require("./hotel/hotel-order-item-price-strategy");
const shipping_profile_shop_resolver_1 = require("./shipping/shipping-profile-shop.resolver");
const delivery_capability_resolver_1 = require("./shipping/delivery-capability.resolver");
const payment_profile_shop_resolver_1 = require("./payment/payment-profile-shop.resolver");
const order_box_service_1 = require("./order/order-box.service");
const order_box_shop_resolver_1 = require("./order/order-box-shop.resolver");
const order_split_service_1 = require("./order/order-split.service");
const order_split_shop_resolver_1 = require("./order/order-split-shop.resolver");
const merchant_settlement_ledger_entity_1 = require("./order/merchant-settlement-ledger.entity");
const merchant_settlement_service_1 = require("./order/merchant-settlement.service");
const merchant_settlement_admin_resolver_1 = require("./order/merchant-settlement-admin.resolver");
const redemption_code_service_1 = require("./redemption/redemption-code.service");
const order_scope_service_1 = require("./order-scope/order-scope.service");
const order_scope_resolver_1 = require("./order-scope/order-scope.resolver");
const redemption_resolver_1 = require("./redemption/redemption.resolver");
const redemption_schema_1 = require("./redemption/redemption.schema");
const hotel_inventory_shop_resolver_1 = require("./hotel/booking/hotel-inventory-shop.resolver");
const hotel_inventory_admin_resolver_1 = require("./hotel/booking/hotel-inventory-admin.resolver");
const rate_plan_admin_resolver_1 = require("./hotel/booking/rate-plan-admin.resolver");
const rate_plan_shop_resolver_1 = require("./hotel/booking/rate-plan-shop.resolver");
const booking_admin_resolver_1 = require("./hotel/booking/booking-admin.resolver");
const booking_shop_resolver_1 = require("./hotel/booking/booking-shop.resolver");
const box_shipping_line_assignment_strategy_1 = require("./shipping/box-shipping-line-assignment-strategy");
const channel_tax_line_calculation_strategy_1 = require("./tax/channel-tax-line-calculation-strategy");
const core_3 = require("@vendure/core");
const after_sales_plugin_1 = require("@vendure/after-sales-plugin");
const default_data_service_1 = require("./seed/default-data.service");
const wallet_entity_1 = require("./wallet/wallet.entity");
const wallet_service_1 = require("./wallet/wallet.service");
const wallet_admin_resolver_1 = require("./wallet/wallet-admin.resolver");
const wallet_shop_resolver_1 = require("./wallet/wallet-shop.resolver");
const balance_wallet_payment_handler_1 = require("./wallet/balance-wallet-payment-handler");
const tenant_catalog_service_1 = require("./tenant/tenant-catalog.service");
const tenant_catalog_admin_resolver_1 = require("./tenant/tenant-catalog-admin.resolver");
const tenant_option_group_service_1 = require("./tenant/tenant-option-group.service");
const stock_location_custom_fields_1 = require("./inventory/stock-location-custom-fields");
const variant_location_binding_entity_1 = require("./inventory/variant-location-binding.entity");
const variant_location_binding_service_1 = require("./inventory/variant-location-binding.service");
const virtual_physical_stock_service_1 = require("./inventory/virtual-physical-stock.service");
const inventory_shop_resolver_1 = require("./inventory/inventory-shop.resolver");
const inventory_plugin_1 = require("@vendure/inventory-plugin");
const delivery_record_service_1 = require("./delivery/delivery-record.service");
const delivery_record_entity_1 = require("./delivery/delivery-record.entity");
const delivery_admin_resolver_1 = require("./delivery/delivery-admin.resolver");
const inventory_admin_resolver_1 = require("./inventory/inventory-admin.resolver");
const reconciliation_entity_1 = require("./reconcile/reconciliation.entity");
const reconciliation_service_1 = require("./reconcile/reconciliation.service");
const reconciliation_admin_resolver_1 = require("./reconcile/reconciliation-admin.resolver");
const stock_doc_entity_1 = require("./inventory/stock-doc.entity");
const stock_doc_item_entity_1 = require("./inventory/stock-doc-item.entity");
const stock_doc_service_1 = require("./inventory/stock-doc.service");
const stock_doc_admin_resolver_1 = require("./inventory/stock-doc.admin.resolver");
const stock_reservation_admin_resolver_1 = require("./inventory/stock-reservation.admin.resolver");
const stock_reservation_entity_1 = require("./inventory/stock-reservation.entity");
const stock_reservation_item_entity_1 = require("./inventory/stock-reservation-item.entity");
const stock_reservation_service_1 = require("./inventory/stock-reservation.service");
const reservation_expiry_task_1 = require("./inventory/reservation-expiry.task");
const inventory_mode_service_1 = require("./inventory/inventory-mode.service");
const inventory_alert_rule_entity_1 = require("./inventory/inventory-alert-rule.entity");
const inventory_alert_rule_service_1 = require("./inventory/inventory-alert-rule.service");
const inventory_stock_service_1 = require("./inventory/inventory-stock.service");
const simple_inventory_adapter_1 = require("./inventory/simple-inventory.adapter");
const odoo_inventory_adapter_1 = require("./inventory/odoo-inventory.adapter");
const inventory_mode_custom_fields_1 = require("./inventory/inventory-mode.custom-fields");
const pick_batch_entity_1 = require("./picking/pick-batch.entity");
const pick_batch_order_entity_1 = require("./picking/pick-batch-order.entity");
const pick_batch_service_1 = require("./picking/pick-batch.service");
const pick_batch_admin_resolver_1 = require("./picking/pick-batch.admin.resolver");
const storage_zone_entity_1 = require("./storage/storage-zone.entity");
const storage_bin_entity_1 = require("./storage/storage-bin.entity");
const variant_storage_bin_entity_1 = require("./storage/variant-storage-bin.entity");
const storage_bin_service_1 = require("./storage/storage-bin.service");
const storage_bin_admin_resolver_1 = require("./storage/storage-bin.admin.resolver");
const storage_bin_shop_resolver_1 = require("./storage/storage-bin.shop.resolver");
const order_address_admin_resolver_1 = require("./order/order-address.admin.resolver");
const stocktake_task_entity_1 = require("./stocktake/stocktake-task.entity");
const stocktake_wave_entity_1 = require("./stocktake/stocktake-wave.entity");
const stocktake_line_entity_1 = require("./stocktake/stocktake-line.entity");
const stocktake_service_1 = require("./stocktake/stocktake.service");
const stocktake_admin_resolver_1 = require("./stocktake/stocktake.admin.resolver");
const stocktake_permissions_1 = require("./stocktake/stocktake-permissions");
/** 幂等合并自定义字段（plugin configuration 可能被调用多次，按 name 去重） */
function mergeCustomFields(existingFields, additions) {
    const names = new Set((existingFields !== null && existingFields !== void 0 ? existingFields : []).map(f => f.name));
    return [...(existingFields !== null && existingFields !== void 0 ? existingFields : []), ...(additions !== null && additions !== void 0 ? additions : []).filter(f => !names.has(f.name))];
}
let CjkPlugin = CjkPlugin_1 = class CjkPlugin {
    constructor(options, moduleRef) {
        this.options = options;
        this.moduleRef = moduleRef;
    }
    static init(options) {
        CjkPlugin_1.options = options;
        return CjkPlugin_1;
    }
    async onApplicationBootstrap() {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
        const injector = new core_1.Injector(this.moduleRef);
        // 注入全局共享余额钱包服务到支付 handler（与现有一致：支付处理器经静态 setter 接收服务）
        (0, balance_wallet_payment_handler_1.setWalletService)(injector.get(wallet_service_1.WalletService));
        // 幂等补种默认房型模板（不覆盖客户改动；删除过的 code 不补回）
        if (this.options.seedDefaultData !== false) {
            const rtService = injector.get(room_template_service_1.RoomTemplateService);
            await rtService.seedDefaultTemplates();
        }
        // 虚拟×物理库存：SALE 同事务镜像虚拟仓（物理驱动变体）
        injector.get(virtual_physical_stock_service_1.VirtualPhysicalStockService).registerMirrorHandler();
        // 多仓拆分发货预留单：ALLOCATION/SALE/CANCELLATION/RELEASE 事件接线（下单/发货/取消）
        injector.get(stock_reservation_service_1.StockReservationService).registerOrderHandlers();
        // 到店核销范围：把本插件的判定实现注册给 coupon-plugin（依赖方向 cjk → coupon，避免成环）
        (0, coupon_plugin_1.setRedeemScopeResolver)(injector.get(redeem_scope_service_1.RedeemScopeService));
        // 幂等创建默认配送/支付数据（自提点、门店自提配送档案、门店收银支付档案）
        if (this.options.seedDefaultData !== false && ((_a = this.options.profiles) === null || _a === void 0 ? void 0 : _a.enabled) !== false) {
            const seedService = injector.get(default_data_service_1.DefaultDataService);
            await seedService.seed();
        }
        if (((_b = this.options.i18n) === null || _b === void 0 ? void 0 : _b.enabled) !== false) {
            const i18nService = injector.get(core_1.I18nService);
            const languages = ((_c = this.options.i18n) === null || _c === void 0 ? void 0 : _c.languages) || ['zh_Hans', 'zh_Hant', 'ja', 'ko'];
            const translations = {
                zh_Hans: require('./i18n/zh_CN.json'),
                zh_Hant: require('./i18n/zh_TW.json'),
                ja: require('./i18n/ja.json'),
                ko: require('./i18n/ko.json'),
            };
            for (const lang of languages) {
                if (translations[lang]) {
                    i18nService.addTranslation(lang, translations[lang]);
                    core_1.Logger.info(`Registered i18n translation for ${lang}`, constants_1.loggerCtx);
                }
            }
        }
        if (((_d = this.options.regions) === null || _d === void 0 ? void 0 : _d.enabled) !== false) {
            core_1.Logger.info('CJK regions module enabled - use RegionPopulator in your server bootstrap to populate countries', constants_1.loggerCtx);
        }
        if ((_e = this.options.cod) === null || _e === void 0 ? void 0 : _e.enabled) {
            core_1.Logger.info('Cash on Delivery payment module enabled', constants_1.loggerCtx);
        }
        if ((_f = this.options.storePickup) === null || _f === void 0 ? void 0 : _f.enabled) {
            core_1.Logger.info('Store pickup shipping module enabled', constants_1.loggerCtx);
        }
        if ((_g = this.options.pickupPoint) === null || _g === void 0 ? void 0 : _g.enabled) {
            core_1.Logger.info('Pickup point shipping module enabled', constants_1.loggerCtx);
        }
        if ((_h = this.options.employeePickup) === null || _h === void 0 ? void 0 : _h.enabled) {
            core_1.Logger.info('Employee pickup shipping module enabled', constants_1.loggerCtx);
        }
        if ((_j = this.options.promotionPolicy) === null || _j === void 0 ? void 0 : _j.enabled) {
            core_1.Logger.info('Promotion stacking policy module enabled', constants_1.loggerCtx);
        }
        if ((_k = this.options.tenant) === null || _k === void 0 ? void 0 : _k.enabled) {
            core_1.Logger.info('Tenant (multi-channel) module enabled', constants_1.loggerCtx);
        }
        // 存量租户默认角色补种子（幂等，仅补缺失；失败不阻塞启动）
        if ((_l = this.options.tenant) === null || _l === void 0 ? void 0 : _l.enabled) {
            try {
                await injector.get(tenant_member_service_1.TenantMemberService).ensureDefaultRolesForAllChannels(core_1.RequestContext.empty());
            }
            catch (e) {
                core_1.Logger.warn(`默认角色补种子失败（可后台手动触发 importDefaultRoles）: ${e.message}`, constants_1.loggerCtx);
            }
        }
        // 超管全局豁免渠道校验：把存量渠道补关联到超管角色（幂等；失败不阻塞启动）
        if ((_m = this.options.tenant) === null || _m === void 0 ? void 0 : _m.enabled) {
            try {
                const tenantSvc = injector.get(tenant_member_service_1.TenantMemberService);
                await tenantSvc.ensureSuperAdminRoleCoversAllChannels(core_1.RequestContext.empty());
            }
            catch (e) {
                core_1.Logger.warn(`超管角色渠道覆盖（存量）失败: ${e.message}`, constants_1.loggerCtx);
            }
        }
        // 将来新建渠道自动关联到超管角色，保证超管在新租户内同样全局豁免
        {
            const eventBus = injector.get(core_3.EventBus);
            eventBus.ofType(core_3.ChannelEvent).subscribe(async (event) => {
                if (event.type !== 'created')
                    return;
                try {
                    await injector
                        .get(tenant_member_service_1.TenantMemberService)
                        .ensureSuperAdminRoleCoversChannel(event.ctx, event.entity.id);
                }
                catch (e) {
                    core_1.Logger.warn(`新渠道关联超管角色失败: ${e.message}`, constants_1.loggerCtx);
                }
            });
        }
        // 注册 Profile 事件订阅
        if (((_o = this.options.profiles) === null || _o === void 0 ? void 0 : _o.enabled) !== false) {
            const eventBus = injector.get(core_3.EventBus);
            const shippingSvc = injector.get(shipping_profile_service_1.ShippingProfileService);
            const paymentSvc = injector.get(payment_profile_service_1.PaymentProfileService);
            const connection = injector.get(core_3.TransactionalConnection);
            // 订单结算时快照 Profile 信息
            eventBus.ofType(core_3.OrderEvent).subscribe(async (event) => {
                var _a, _b, _c, _d, _e;
                if (event.type !== 'updated')
                    return;
                const order = event.entity;
                if (order.state !== 'PaymentSettled' && order.state !== 'PaymentAuthorized')
                    return;
                const lines = (_a = order.lines) !== null && _a !== void 0 ? _a : [];
                if (lines.length === 0)
                    return;
                try {
                    const shippingProfileNames = {};
                    const paymentProfileNames = {};
                    for (const line of lines) {
                        const variant = line.productVariant;
                        if (!variant)
                            continue;
                        const spId = (_b = variant.customFields) === null || _b === void 0 ? void 0 : _b.shippingProfileId;
                        const ppId = (_c = variant.customFields) === null || _c === void 0 ? void 0 : _c.paymentProfileId;
                        if (spId && !shippingProfileNames[spId]) {
                            const profile = await shippingSvc.findOne(event.ctx, spId);
                            shippingProfileNames[spId] = (_d = profile === null || profile === void 0 ? void 0 : profile.name) !== null && _d !== void 0 ? _d : spId;
                        }
                        if (ppId && !paymentProfileNames[ppId]) {
                            const profile = await paymentSvc.findOne(event.ctx, ppId);
                            paymentProfileNames[ppId] = (_e = profile === null || profile === void 0 ? void 0 : profile.name) !== null && _e !== void 0 ? _e : ppId;
                        }
                    }
                    const orderRepo = connection.getRepository(event.ctx, 'Order');
                    await orderRepo.update(order.id, {
                        customFields: {
                            shippingProfileSnapshot: JSON.stringify(shippingProfileNames),
                            paymentProfileSnapshot: JSON.stringify(paymentProfileNames),
                        },
                    });
                }
                catch (e) {
                    core_1.Logger.error(`Failed to save profile snapshot: ${e.message}`, constants_1.loggerCtx);
                }
            });
            // 加购时检测混合 Profile 并记录日志
            eventBus.ofType(core_3.OrderEvent).subscribe(async (event) => {
                var _a, _b, _c;
                if (event.type !== 'updated')
                    return;
                const order = event.entity;
                if (order.state !== 'AddingItems')
                    return;
                const lines = (_a = order.lines) !== null && _a !== void 0 ? _a : [];
                if (lines.length < 2)
                    return;
                const profileIds = new Set();
                for (const line of lines) {
                    const spId = (_c = (_b = line.productVariant) === null || _b === void 0 ? void 0 : _b.customFields) === null || _c === void 0 ? void 0 : _c.shippingProfileId;
                    if (spId)
                        profileIds.add(spId);
                }
                if (profileIds.size > 1) {
                    core_1.Logger.info(`Order ${order.code} has mixed shipping profiles: ${[...profileIds].join(', ')}`, constants_1.loggerCtx);
                }
            });
        }
        // 酒店预订单事件联动（P3）：订单进入可处理状态 → 建 pending 预订单；
        // PartiallyPaid（支付计划首期付清）/ PaymentSettled（全清）→ 自动确认（入住码+取消截止点+锁房 booked）
        // 触发源两路：OrderEvent 'updated'（客户/自定义字段更新）+ OrderStateTransitionEvent
        // （支付结算与状态流转只发后者，不发 OrderEvent）；transition 事件上的 order 缺
        // lines/customer 关系，service 内按 id 重取（handleOrderTransition）。ensure 幂等，双路无副作用。
        {
            const eventBus = injector.get(core_3.EventBus);
            const bookingService = injector.get(booking_service_1.HotelBookingService);
            eventBus.ofType(core_3.OrderEvent).subscribe(async (event) => {
                if (event.type !== 'updated')
                    return;
                try {
                    await bookingService.handleOrderUpdated(event.ctx, event.entity);
                }
                catch (e) {
                    core_1.Logger.error(`hotel booking event failed: ${e === null || e === void 0 ? void 0 : e.message}`, constants_1.loggerCtx);
                }
            });
            eventBus.ofType(core_3.OrderStateTransitionEvent).subscribe(async (event) => {
                try {
                    await bookingService.handleOrderTransition(event.ctx, event.order.id);
                }
                catch (e) {
                    core_1.Logger.error(`hotel booking transition event failed: ${e === null || e === void 0 ? void 0 : e.message}`, constants_1.loggerCtx);
                }
            });
            // P4 Task 15：改期补差 Payment Settled → 自动落地改期；Cancelled/Declined/Error → 清在途意向。
            // 非补差支付（metadata 无标记）在 service 内 no-op。
            eventBus.ofType(core_3.PaymentStateTransitionEvent).subscribe(async (event) => {
                try {
                    await bookingService.handleReschedulePayment(event);
                }
                catch (e) {
                    core_1.Logger.error(`hotel reschedule payment event failed: ${e === null || e === void 0 ? void 0 : e.message}`, constants_1.loggerCtx);
                }
            });
        }
        // P4 Task 14：跨插件注入 AfterSalesService（延迟注入规避模块顺序）；
        // 订阅售后状态机事件：refund_only 退款 Refunded → 预订自动 cancelled + 释放锁房（逾时扣首晚审批收口）。
        // AfterSalesPlugin 未安装的部署降级：注入失败仅告警，顾客侧退款取消将被服务层拒绝。
        try {
            const afterSalesService = injector.get(after_sales_plugin_1.AfterSalesService);
            const bookingServiceForCancel = injector.get(booking_service_1.HotelBookingService);
            bookingServiceForCancel.setAfterSalesService(afterSalesService);
            injector.get(core_3.EventBus).ofType(after_sales_plugin_1.AfterSalesStateTransitionEvent).subscribe(async (event) => {
                try {
                    await bookingServiceForCancel.handleAfterSalesRefunded(event);
                }
                catch (e) {
                    core_1.Logger.error(`hotel after-sales refund event failed: ${e === null || e === void 0 ? void 0 : e.message}`, constants_1.loggerCtx);
                }
            });
        }
        catch (e) {
            core_1.Logger.warn(`AfterSalesService not available, hotel booking refund cancel disabled: ${e === null || e === void 0 ? void 0 : e.message}`, constants_1.loggerCtx);
        }
        // 核销码改由 checkoutSplitted（performSplitCheckout）同步 best-effort 生成，并在 C端
        // orderRedemptionCode（ensure 写后重读对账）兜底。原 OrderStateTransitionEvent 异步后台 ensure
        // 会与同步 ensure 并发生成不同码、后写覆盖导致 lookupByCode 查不到（spurious not_found），已移除。
        // 方案2-C 日批：每 5 分钟检查，若当日批未跑则执行（每日 2:00 后首查触发；仅物理库存租户）
        {
            const svc = injector.get(reconciliation_service_1.ReconciliationService);
            const channelSvc = injector.get(core_1.ChannelService);
            let lastDate = '';
            setInterval(async () => {
                var _a;
                try {
                    const now = new Date();
                    const date = now.toISOString().slice(0, 10);
                    if (date === lastDate) {
                        return;
                    }
                    if (now.getHours() < 2) {
                        return;
                    }
                    const page = await channelSvc.findAll(core_1.RequestContext.empty(), { take: 200 });
                    for (const ch of page.items) {
                        const enabled = Boolean((_a = ch.customFields) === null || _a === void 0 ? void 0 : _a.physicalStockEnabled);
                        if (!enabled) {
                            continue;
                        }
                        const ctx = new core_1.RequestContext({
                            apiType: 'admin',
                            isAuthorized: true,
                            authorizedAsOwnerOnly: false,
                            channel: ch,
                            session: undefined,
                        });
                        await svc.runBatch(ctx, date, 'cron');
                    }
                    lastDate = date;
                }
                catch (e) {
                    core_1.Logger.error(`日批对账失败: ${e === null || e === void 0 ? void 0 : e.message}`, 'ReconciliationCron');
                }
            }, 5 * 60 * 1000);
        }
    }
    configure(consumer) { }
};
exports.CjkPlugin = CjkPlugin;
exports.CjkPlugin = CjkPlugin = CjkPlugin_1 = __decorate([
    (0, core_1.VendurePlugin)({
        imports: [core_1.PluginCommonModule],
        entities: [pickup_location_entity_1.PickupLocation, enterprise_customer_entity_1.EmployeeCustomer, shipping_template_entity_1.ShippingTemplate, shipping_profile_entity_1.ShippingProfile, payment_profile_entity_1.PaymentProfile, shipping_profile_method_entity_1.ShippingProfileMethod, payment_profile_method_entity_1.PaymentProfileMethod, payment_template_entity_1.PaymentTemplate, room_template_entity_1.RoomTemplate, room_template_control_entity_1.RoomTemplateControl, room_day_entity_1.HotelRoomDay, booking_lock_entity_1.HotelBookingLock, rate_plan_entity_1.HotelRatePlan, booking_entity_1.HotelBooking, tenant_member_entity_1.TenantMember, wallet_entity_1.Wallet, merchant_settlement_ledger_entity_1.MerchantSettlementLedger, variant_location_binding_entity_1.VariantLocationBinding, delivery_record_entity_1.DeliveryRecord, reconciliation_entity_1.ReconciliationBatch, reconciliation_entity_1.ReconciliationOrderLine, stock_doc_entity_1.StockDocEntity, stock_doc_item_entity_1.StockDocItemEntity, inventory_alert_rule_entity_1.InventoryAlertRuleEntity, stock_reservation_entity_1.StockReservationEntity, stock_reservation_item_entity_1.StockReservationItemEntity, pick_batch_entity_1.PickBatch, pick_batch_order_entity_1.PickBatchOrder, storage_zone_entity_1.StorageZone, storage_bin_entity_1.StorageBin, variant_storage_bin_entity_1.VariantStorageBin,
            stocktake_task_entity_1.StocktakeTask,
            stocktake_wave_entity_1.StocktakeWave,
            stocktake_line_entity_1.StocktakeLine,
        ],
        providers: [
            { provide: constants_1.CJK_PLUGIN_OPTIONS, useFactory: () => CjkPlugin.options },
            tenant_setup_service_1.TenantSetupService,
            pickup_location_service_1.PickupLocationService,
            enterprise_customer_service_1.EmployeeCustomerService,
            domain_resolver_service_1.DomainResolverService,
            map_provider_registry_1.MapProviderRegistry,
            map_service_1.MapService,
            { provide: core_2.APP_GUARD, useClass: auth_method_guard_1.AuthMethodGuard },
            { provide: core_2.APP_GUARD, useClass: tenant_enabled_guard_1.TenantEnabledGuard },
            migrations_1.MapConfigEncryptionMigration,
            migrations_1.PayConfigEncryptionMigration,
            migrations_1.TenantMemberColumnMigration,
            migrations_1.AddTenantMemberRedeemProfiles,
            migrations_1.ChannelCustomColumnMigration,
            migrations_1.ReservationExpiresAtMigration,
            migrations_1.ReservationTtlColumnMigration,
            migrations_1.PickBatchHandoverColumnMigration,
            migrations_1.StocktakePostedDocIndexMigration,
            migrations_1.ShippingContactFlagMigration,
            migrations_1.StockTableMigration,
            migrations_1.ChannelInventoryModeColumnMigration,
            migrations_1.CollectionIconMigration,
            migrations_1.HotelOrderLineColumnMigration,
            migrations_1.HotelBookingCancelColumnsMigration,
            migrations_1.HotelBookingRescheduleColumnsMigration,
            migrations_1.PaymentProfileMethodTableMigration,
            migrations_1.PickupStoreLinkSoftDeleteMigration,
            migrations_1.PickupPermissionsRoleGrantMigration,
            auth_config_service_1.AuthConfigService,
            pay_config_service_1.PayConfigService,
            map_config_service_1.MapConfigService,
            sso_provider_service_1.SsoProviderService,
            invite_code_service_1.InviteCodeService,
            basic_config_service_1.BasicConfigService,
            channel_provisioning_service_1.ChannelProvisioningService,
            service_notify_config_service_1.ServiceNotifyConfigService,
            multi_language_config_service_1.MultiLanguageConfigService,
            shipping_template_service_1.ShippingTemplateService,
            shipping_profile_service_1.ShippingProfileService,
            delivery_facet_service_1.DeliveryFacetService,
            payment_profile_service_1.PaymentProfileService,
            payment_template_service_1.PaymentTemplateService,
            room_template_service_1.RoomTemplateService,
            hotel_inventory_service_1.HotelInventoryService,
            rate_plan_service_1.HotelRatePlanService,
            booking_service_1.HotelBookingService,
            default_data_service_1.DefaultDataService,
            tenant_member_service_1.TenantMemberService,
            redeem_scope_service_1.RedeemScopeService,
            order_box_service_1.OrderBoxService,
            order_split_service_1.OrderSplitService,
            merchant_settlement_service_1.MerchantSettlementService,
            wallet_service_1.WalletService,
            tenant_catalog_service_1.TenantCatalogService,
            tenant_option_group_service_1.TenantOptionGroupService,
            redemption_code_service_1.RedemptionCodeService,
            order_scope_service_1.OrderScopeService,
            variant_location_binding_service_1.VariantLocationBindingService,
            inventory_plugin_1.StockLedgerService,
            inventory_plugin_1.InventoryService,
            virtual_physical_stock_service_1.VirtualPhysicalStockService,
            stock_doc_service_1.StockDocService,
            stock_reservation_service_1.StockReservationService,
            inventory_mode_service_1.InventoryModeService,
            inventory_alert_rule_service_1.InventoryAlertRuleService,
            inventory_stock_service_1.InventoryStockService,
            simple_inventory_adapter_1.SimpleInventoryAdapter,
            odoo_inventory_adapter_1.OdooInventoryAdapter,
            delivery_record_service_1.DeliveryRecordService,
            reconciliation_service_1.ReconciliationService,
            pick_batch_service_1.PickBatchService,
            storage_bin_service_1.StorageBinService,
            stocktake_service_1.StocktakeService,
        ],
        adminApiExtensions: {
            schema: () => {
                const { gql } = require('graphql-tag');
                return gql `
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

                ${redemption_schema_1.redemptionAdminSchema}

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
            resolvers: [pickup_location_admin_resolver_1.PickupLocationAdminResolver, enterprise_customer_admin_resolver_1.EmployeeCustomerAdminResolver, auth_admin_resolver_1.AuthAdminResolver, map_admin_resolver_1.MapAdminResolver, tenant_config_admin_resolver_1.TenantConfigAdminResolver, shipping_template_admin_resolver_1.ShippingTemplateAdminResolver, shipping_profile_admin_resolver_1.ShippingProfileAdminResolver, payment_profile_admin_resolver_1.PaymentProfileAdminResolver, payment_template_admin_resolver_1.PaymentTemplateAdminResolver, room_template_admin_resolver_1.RoomTemplateAdminResolver, tenant_admin_resolver_1.TenantAdminResolver, tenant_member_resolver_1.TenantMemberResolver, my_access_resolver_1.MyAccessResolver, wallet_admin_resolver_1.WalletAdminResolver, tenant_catalog_admin_resolver_1.TenantCatalogAdminResolver, asset_library_admin_resolver_1.AssetLibraryAdminResolver, redemption_resolver_1.RedemptionAdminResolver, merchant_settlement_admin_resolver_1.MerchantSettlementAdminResolver, delivery_admin_resolver_1.DeliveryAdminResolver, inventory_admin_resolver_1.InventoryAdminResolver, reconciliation_admin_resolver_1.ReconciliationAdminResolver, stock_doc_admin_resolver_1.StockDocAdminResolver, stock_reservation_admin_resolver_1.StockReservationAdminResolver, delivery_capability_resolver_1.DeliveryCapabilityResolver, pick_batch_admin_resolver_1.PickBatchAdminResolver, stocktake_admin_resolver_1.StocktakeAdminResolver, order_address_admin_resolver_1.OrderAddressAdminResolver, stocktake_admin_resolver_1.StocktakeAdminResolver, order_price_admin_resolver_1.OrderPriceAdminResolver, hotel_inventory_admin_resolver_1.HotelInventoryAdminResolver, rate_plan_admin_resolver_1.HotelRatePlanAdminResolver, booking_admin_resolver_1.HotelBookingAdminResolver, order_scope_resolver_1.OrderScopeAdminResolver, storage_bin_admin_resolver_1.StorageBinAdminResolver],
        },
        shopApiExtensions: {
            schema: () => {
                const { gql } = require('graphql-tag');
                return gql `
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

                ${redemption_schema_1.redemptionShopSchema}
            `;
            },
            resolvers: [pickup_location_shop_resolver_1.PickupLocationShopResolver, pickup_shop_resolver_1.PickupShopResolver, auth_shop_resolver_1.AuthShopResolver, domain_shop_resolver_1.DomainShopResolver, map_shop_resolver_1.MapShopResolver, shipping_profile_shop_resolver_1.ShippingProfileShopResolver, delivery_capability_resolver_1.DeliveryCapabilityResolver, payment_profile_shop_resolver_1.PaymentProfileShopResolver, order_box_shop_resolver_1.OrderBoxShopResolver, order_split_shop_resolver_1.OrderSplitShopResolver, wallet_shop_resolver_1.WalletShopResolver, redemption_resolver_1.RedemptionShopResolver, inventory_shop_resolver_1.InventoryShopResolver, storage_bin_shop_resolver_1.StorageBinShopResolver, customer_asset_shop_resolver_1.CustomerAssetShopResolver, my_orders_shop_resolver_1.MyOrdersShopResolver, hotel_inventory_shop_resolver_1.HotelInventoryShopResolver, rate_plan_shop_resolver_1.HotelRatePlanShopResolver, booking_shop_resolver_1.HotelBookingShopResolver],
        },
        configuration: config => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9;
            // 注入 authSecret 到 crypto 模块（configuration 在 bootstrap 早期执行，此时 options 已可用）
            (0, crypto_1.setAuthSecret)(CjkPlugin.options.authSecret);
            // 租户级税率方式（三态 taxMode：inclusive 含税价含拆税 / zero 零税价净价结算 / exclusive 不含税价价税分离）。
            // resolveTaxMode 兼容旧 taxEnabled（true→inclusive，false→zero），存量租户行为不回退。
            config.taxOptions = config.taxOptions || {};
            config.taxOptions.taxLineCalculationStrategy = new channel_tax_line_calculation_strategy_1.ChannelTaxLineCalculationStrategy();
            // 注册 SSO 策略到 shop 端（init 钩子由 Vendure 自动调用）
            config.authOptions = config.authOptions || {};
            config.authOptions.shopAuthenticationStrategy = [
                ...(config.authOptions.shopAuthenticationStrategy || []),
                sso_authentication_strategy_1.ssoAuthenticationStrategy, // 使用单例：resolver 经 export 访问 bindIdentityToUser
            ];
            if ((_a = CjkPlugin.options.cod) === null || _a === void 0 ? void 0 : _a.enabled) {
                config.paymentOptions.paymentMethodHandlers = [
                    ...(config.paymentOptions.paymentMethodHandlers || []),
                    cod_handler_1.codPaymentHandler,
                ];
            }
            // 聚合码支付（线下扫码 + 自确认），默认启用
            if (((_b = CjkPlugin.options.aggregate) === null || _b === void 0 ? void 0 : _b.enabled) !== false) {
                config.paymentOptions.paymentMethodHandlers = [
                    ...(config.paymentOptions.paymentMethodHandlers || []),
                    aggregate_payment_handler_1.aggregatePaymentHandler,
                ];
            }
            // 固定聚合码收款（门店到店收银，自确认），默认启用
            if (((_c = CjkPlugin.options.aggregate) === null || _c === void 0 ? void 0 : _c.enabled) !== false) {
                config.paymentOptions.paymentMethodHandlers = [
                    ...(config.paymentOptions.paymentMethodHandlers || []),
                    fixed_aggregate_collection_handler_1.fixedAggregateCollectionHandler,
                ];
            }
            // 全局共享余额钱包支付（跨租户/跨档案合单），默认启用
            config.paymentOptions.paymentMethodHandlers = [
                ...(config.paymentOptions.paymentMethodHandlers || []),
                balance_wallet_payment_handler_1.balanceWalletPaymentHandler,
            ];
            const hasPickup = ((_d = CjkPlugin.options.storePickup) === null || _d === void 0 ? void 0 : _d.enabled)
                || ((_e = CjkPlugin.options.pickupPoint) === null || _e === void 0 ? void 0 : _e.enabled)
                || ((_f = CjkPlugin.options.employeePickup) === null || _f === void 0 ? void 0 : _f.enabled);
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
                if ((_g = CjkPlugin.options.storePickup) === null || _g === void 0 ? void 0 : _g.enabled) {
                    config.shippingOptions.shippingEligibilityCheckers.push(pickup_eligibility_checker_1.storePickupEligibilityChecker);
                    config.shippingOptions.shippingCalculators.push(pickup_calculator_1.storePickupCalculator);
                    config.shippingOptions.fulfillmentHandlers.push(pickup_fulfillment_handler_1.storePickupFulfillmentHandler);
                }
                if ((_h = CjkPlugin.options.pickupPoint) === null || _h === void 0 ? void 0 : _h.enabled) {
                    config.shippingOptions.shippingEligibilityCheckers.push(pickup_eligibility_checker_1.pickupPointEligibilityChecker);
                    config.shippingOptions.shippingCalculators.push(pickup_calculator_1.pickupPointCalculator);
                    config.shippingOptions.fulfillmentHandlers.push(pickup_fulfillment_handler_1.pickupPointFulfillmentHandler);
                }
                if ((_j = CjkPlugin.options.employeePickup) === null || _j === void 0 ? void 0 : _j.enabled) {
                    config.shippingOptions.shippingEligibilityCheckers.push(pickup_eligibility_checker_1.employeePickupEligibilityChecker);
                    config.shippingOptions.shippingCalculators.push(pickup_calculator_1.employeePickupCalculator);
                    config.shippingOptions.fulfillmentHandlers.push(pickup_fulfillment_handler_1.employeePickupFulfillmentHandler);
                }
            }
            // 阶梯重量/件数计费（始终注册，供快递配送方式使用）
            config.shippingOptions = config.shippingOptions || {};
            config.shippingOptions.shippingEligibilityCheckers = [
                ...(config.shippingOptions.shippingEligibilityCheckers || []),
                tiered_shipping_eligibility_checker_1.tieredShippingEligibilityChecker,
            ];
            config.shippingOptions.shippingCalculators = [
                ...(config.shippingOptions.shippingCalculators || []),
                tiered_shipping_calculator_1.tieredWeightShippingCalculator,
                tiered_shipping_calculator_1.tieredQuantityShippingCalculator,
                pickup_calculator_1.localDeliveryCalculator,
            ];
            // 按配送档案分箱：多配送方式时每个 ShippingLine 只挂其箱内 OrderLine，
            // 支撑「单订单内多配送组 / 多 fulfillment」。单箱场景退化为默认全量分配。
            config.shippingOptions.shippingLineAssignmentStrategy = new box_shipping_line_assignment_strategy_1.BoxShippingLineAssignmentStrategy();
            if ((_k = CjkPlugin.options.promotionPolicy) === null || _k === void 0 ? void 0 : _k.enabled) {
                config.promotionOptions = config.promotionOptions || {};
                config.promotionOptions.promotionConditions = [
                    ...(config.promotionOptions.promotionConditions || []),
                    coupon_stackable_condition_1.couponStackableCondition,
                ];
                config.customFields = Object.assign(Object.assign({}, config.customFields), { Promotion: [
                        ...(((_l = config.customFields) === null || _l === void 0 ? void 0 : _l.Promotion) || []),
                        ...promotion_custom_fields_1.promotionCustomFields.Promotion,
                    ] });
            }
            if ((_m = CjkPlugin.options.tenant) === null || _m === void 0 ? void 0 : _m.enabled) {
                // 合并租户 Channel 自定义字段，按 name 去重：dev-config 或其它插件已定义的同名字段以既有为准
                // （与下方 ProductVariant 合并去重、ShopPlugin.mergeCustomFields 保持一致，避免复制 app 崩溃报 duplicated custom field）。
                const existingChannelNames = (((_o = config.customFields) === null || _o === void 0 ? void 0 : _o.Channel) || []).map(f => f.name);
                const newChannelFields = [
                    ...(tenant_channel_custom_fields_1.tenantChannelCustomFields.Channel || []),
                    ...inventory_mode_custom_fields_1.inventoryModeChannelFields,
                ].filter(f => !existingChannelNames.includes(f.name));
                if (newChannelFields.length > 0) {
                    config.customFields = Object.assign(Object.assign({}, config.customFields), { Channel: [
                            ...(((_p = config.customFields) === null || _p === void 0 ? void 0 : _p.Channel) || []),
                            ...newChannelFields,
                        ] });
                }
            }
            // 注册商品类型 customFields（实体/虚拟/服务；按 name 去重，dev-config 已定义的同名字段以既有为准）
            config.customFields = Object.assign(Object.assign({}, config.customFields), { Product: [
                    ...(((_q = config.customFields) === null || _q === void 0 ? void 0 : _q.Product) || []),
                    ...(product_custom_fields_1.productTypeCustomFields.Product || []).filter(f => { var _a; return !(((_a = config.customFields) === null || _a === void 0 ? void 0 : _a.Product) || []).some(e => e.name === f.name); }),
                ] });
            // 注册 Order customFields（selectedPickupLocationId、pickupType）
            config.customFields = Object.assign(Object.assign({}, config.customFields), { Order: [
                    ...(((_r = config.customFields) === null || _r === void 0 ? void 0 : _r.Order) || []),
                    ...order_custom_fields_1.orderCustomFields.Order,
                ] });
            // 注册 Channel customFields（后台改价幅度上限）—— 去重防止重复注册
            {
                const existingChannelNames = (((_s = config.customFields) === null || _s === void 0 ? void 0 : _s.Channel) || []).map(f => f.name);
                const newChannelFields = (order_price_custom_fields_1.orderPriceChannelCustomFields.Channel || []).filter(f => !existingChannelNames.includes(f.name));
                if (newChannelFields.length > 0) {
                    config.customFields = Object.assign(Object.assign({}, config.customFields), { Channel: [
                            ...(((_t = config.customFields) === null || _t === void 0 ? void 0 : _t.Channel) || []),
                            ...newChannelFields,
                        ] });
                }
            }
            config.customFields = Object.assign(Object.assign({}, config.customFields), { Customer: [
                    ...(((_u = config.customFields) === null || _u === void 0 ? void 0 : _u.Customer) || []),
                    ...customer_custom_fields_1.customerCustomFields.Customer,
                ] });
            // 注册 ProductVariant customFields（weight/dimensions）—— 去重防止重复注册
            {
                const existingPvFields = (((_v = config.customFields) === null || _v === void 0 ? void 0 : _v.ProductVariant) || []).map(f => f.name);
                const newPvFields = (product_variant_custom_fields_1.productVariantCustomFields.ProductVariant || []).filter(f => !existingPvFields.includes(f.name));
                if (newPvFields.length > 0) {
                    config.customFields = Object.assign(Object.assign({}, config.customFields), { ProductVariant: [
                            ...(((_w = config.customFields) === null || _w === void 0 ? void 0 : _w.ProductVariant) || []),
                            ...newPvFields,
                        ] });
                }
            }
            // 注册 ProductVariant customFields（hotelRoomConfig）—— 与上方 weight/dimensions 同款去重
            {
                const existingHotelPvFields = (((_x = config.customFields) === null || _x === void 0 ? void 0 : _x.ProductVariant) || []).map(f => f.name);
                const newHotelPvFields = (hotel_custom_fields_1.hotelRoomCustomFields.ProductVariant || []).filter(f => !existingHotelPvFields.includes(f.name));
                if (newHotelPvFields.length > 0) {
                    config.customFields = Object.assign(Object.assign({}, config.customFields), { ProductVariant: [...(((_y = config.customFields) === null || _y === void 0 ? void 0 : _y.ProductVariant) || []), ...newHotelPvFields] });
                }
            }
            // 注册 OrderLine customFields（酒店入住日期/晚数）—— 去重防止重复注册
            {
                const existingHotelOlFields = (((_z = config.customFields) === null || _z === void 0 ? void 0 : _z.OrderLine) || []).map(f => f.name);
                const newHotelOlFields = (hotel_order_line_custom_fields_1.hotelOrderLineCustomFields.OrderLine || []).filter(f => !existingHotelOlFields.includes(f.name));
                if (newHotelOlFields.length > 0) {
                    config.customFields = Object.assign(Object.assign({}, config.customFields), { OrderLine: [...(((_0 = config.customFields) === null || _0 === void 0 ? void 0 : _0.OrderLine) || []), ...newHotelOlFields] });
                }
            }
            // 注册 ShippingMethod customFields（enabled 启停）—— 去重防止重复注册
            {
                const existingSmFields = (((_1 = config.customFields) === null || _1 === void 0 ? void 0 : _1.ShippingMethod) || []).map(f => f.name);
                const newSmFields = (shipping_method_custom_fields_1.customShippingMethodFields.ShippingMethod || []).filter(f => !existingSmFields.includes(f.name));
                if (newSmFields.length > 0) {
                    config.customFields = Object.assign(Object.assign({}, config.customFields), { ShippingMethod: [
                            ...(((_2 = config.customFields) === null || _2 === void 0 ? void 0 : _2.ShippingMethod) || []),
                            ...newSmFields,
                        ] });
                }
            }
            // 注册 Asset customFields（uploadedBy 记录上传者，供图库按用户过滤）—— 去重防止重复注册
            {
                const existingAssetFields = (((_3 = config.customFields) === null || _3 === void 0 ? void 0 : _3.Asset) || []).map(f => f.name);
                const newAssetFields = (asset_custom_fields_1.assetCustomFields.Asset || []).filter(f => !existingAssetFields.includes(f.name));
                if (newAssetFields.length > 0) {
                    config.customFields = Object.assign(Object.assign({}, config.customFields), { Asset: [
                            ...(((_4 = config.customFields) === null || _4 === void 0 ? void 0 : _4.Asset) || []),
                            ...newAssetFields,
                        ] });
                }
            }
            // 注册 StockLocation customFields（kind/code）—— 去重防止重复注册
            {
                const existingSlFields = (((_5 = config.customFields) === null || _5 === void 0 ? void 0 : _5.StockLocation) || []).map(f => f.name);
                const newSlFields = (stock_location_custom_fields_1.stockLocationCustomFields.StockLocation || []).filter(f => !existingSlFields.includes(f.name));
                if (newSlFields.length > 0) {
                    config.customFields = Object.assign(Object.assign({}, config.customFields), { StockLocation: [
                            ...(((_6 = config.customFields) === null || _6 === void 0 ? void 0 : _6.StockLocation) || []),
                            ...newSlFields,
                        ] });
                }
            }
            // 注册 Collection customFields（icon 分类图标）—— 去重防止重复注册
            {
                const existingCollectionFields = (((_7 = config.customFields) === null || _7 === void 0 ? void 0 : _7.Collection) || []).map(f => f.name);
                const newCollectionFields = [
                    {
                        name: 'icon',
                        type: 'string',
                        label: [
                            { languageCode: core_1.LanguageCode.zh_Hans, value: '分类图标' },
                            { languageCode: core_1.LanguageCode.en, value: 'Category icon' },
                        ],
                        nullable: true,
                        public: true,
                    },
                ].filter(f => !existingCollectionFields.includes(f.name));
                if (newCollectionFields.length > 0) {
                    config.customFields = Object.assign(Object.assign({}, config.customFields), { Collection: [
                            ...(((_8 = config.customFields) === null || _8 === void 0 ? void 0 : _8.Collection) || []),
                            ...newCollectionFields,
                        ] });
                }
            }
            // 注册自定义权限（PickupPermissions）
            config.authOptions = config.authOptions || {};
            config.authOptions.customPermissions = [
                ...(config.authOptions.customPermissions || []),
                ...pickup_permissions_1.pickupPermissionDefinitions,
            ];
            // 注册 PickupLocation 全局归属权限（SetGlobalPickupLocation）
            config.authOptions.customPermissions = [
                ...(config.authOptions.customPermissions || []),
                ...pickup_location_permissions_1.pickupLocationPermissionDefinitions,
            ];
            config.authOptions.customPermissions = [
                ...(config.authOptions.customPermissions || []),
                tenant_config_permissions_1.tenantConfigPermission,
            ];
            // 注册 ShippingTemplate 权限
            config.authOptions.customPermissions = [
                ...(config.authOptions.customPermissions || []),
                ...shipping_template_permissions_1.shippingTemplatePermissionDefinitions,
            ];
            // 注册 ShippingProfile 权限
            config.authOptions.customPermissions = [
                ...(config.authOptions.customPermissions || []),
                ...shipping_profile_permissions_1.shippingProfilePermissionDefinitions,
            ];
            // 注册 PaymentProfile 权限
            config.authOptions.customPermissions = [
                ...(config.authOptions.customPermissions || []),
                ...payment_profile_permissions_1.paymentProfilePermissionDefinitions,
            ];
            // 注册 PaymentTemplate 权限
            config.authOptions.customPermissions = [
                ...(config.authOptions.customPermissions || []),
                ...payment_template_permissions_1.paymentTemplatePermissionDefinitions,
            ];
            // 注册租户管理/角色/人员/核销自定义权限
            config.authOptions.customPermissions = [
                ...(config.authOptions.customPermissions || []),
                ...tenant_permissions_1.tenantPermissionDefinitions,
            ];
            // 注册多人协同盘库权限（StocktakeCount / StocktakePost）
            config.authOptions.customPermissions = [
                ...(config.authOptions.customPermissions || []),
                ...stocktake_permissions_1.stocktakePermissionDefinitions,
            ];
            // 注册 Channel customFields（预留单有效期 reservationTtlMinutes）—— 按 name 去重合并
            config.customFields.Channel = mergeCustomFields(config.customFields.Channel, [
                {
                    name: 'reservationTtlMinutes',
                    // 注意：不能写 'number' —— Vendure 的 getColumnType 白名单只有
                    // string/localeString/text/localeText/boolean/int/float/datetime/struct，
                    // 非白名单值会在 preBootstrapConfig 里 assertNever 抛错导致服务起不来。
                    type: 'int',
                    label: [{ languageCode: core_1.LanguageCode.zh_Hans, value: '预留单有效期（分钟）' }],
                    description: [
                        {
                            languageCode: core_1.LanguageCode.zh_Hans,
                            value: '预留单超时自动释放时长，默认 30；仅对未完成备货拆分的预留单生效',
                        },
                    ],
                },
            ]);
            // 注册预留单超时释放 ScheduledTask（由 DefaultSchedulerPlugin 在 worker 上周期执行）
            if (!config.schedulerOptions) {
                config.schedulerOptions = { tasks: [] };
            }
            if (!config.schedulerOptions.tasks) {
                config.schedulerOptions.tasks = [];
            }
            if (!config.schedulerOptions.tasks.some(t => t.id === reservation_expiry_task_1.RELEASE_EXPIRED_RESERVATIONS_TASK_ID)) {
                config.schedulerOptions.tasks.push(reservation_expiry_task_1.releaseExpiredReservationsTask);
            }
            // 注册过期锁房单释放 ScheduledTask（每小时；hold 统计口径已排除过期，此任务收敛状态与审计）
            if (!config.schedulerOptions.tasks.some(t => t.id === release_expired_holds_task_1.RELEASE_EXPIRED_HOTEL_HOLDS_TASK_ID)) {
                config.schedulerOptions.tasks.push(release_expired_holds_task_1.releaseExpiredHotelHoldsTask);
            }
            // 注册酒店预订日常流转 ScheduledTask（每日：离店日 completed、过离店日未入住 noShow）
            if (!config.schedulerOptions.tasks.some(t => t.id === booking_daily_transition_task_1.HOTEL_BOOKING_DAILY_TRANSITION_TASK_ID)) {
                config.schedulerOptions.tasks.push(booking_daily_transition_task_1.hotelBookingDailyTransitionTask);
            }
            // 注册订单行单价策略：酒店房型按入离日期逐晚计价，其它变体直通默认价
            config.orderOptions = Object.assign(Object.assign({}, ((_9 = config.orderOptions) !== null && _9 !== void 0 ? _9 : {})), { orderItemPriceCalculationStrategy: new hotel_order_item_price_strategy_1.HotelOrderItemPriceCalculationStrategy() });
            // 注册酒店防超订拦截器（幂等：configuration 可能被调用多次）
            if (!Array.isArray(config.orderOptions.orderInterceptors)) {
                config.orderOptions.orderInterceptors = [];
            }
            if (!config.orderOptions.orderInterceptors.some(i => i instanceof hotel_order_interceptor_1.HotelOrderInterceptor)) {
                config.orderOptions.orderInterceptors.push(new hotel_order_interceptor_1.HotelOrderInterceptor());
            }
            return config;
        },
        dashboard: '../dashboard/index.tsx',
        compatibility: '^3.0.0',
    }),
    __param(0, (0, common_1.Inject)(constants_1.CJK_PLUGIN_OPTIONS)),
    __metadata("design:paramtypes", [Object, core_2.ModuleRef])
], CjkPlugin);
//# sourceMappingURL=plugin.js.map