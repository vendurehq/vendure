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
Object.defineProperty(exports, "__esModule", { value: true });
exports.FIXED_AGGREGATE_COLLECTION_TEMPLATE_CODE = exports.AGGREGATE_PAYMENT_TEMPLATE_CODE = exports.BALANCE_PAY_TEMPLATE_CODE = exports.COD_PAYMENT_TEMPLATE_CODE = exports.CASHIER_PAYMENT_PROFILE_CODE = exports.CASHIER_PAYMENT_METHOD_CODE = exports.STORE_PICKUP_PROFILE_CODE = exports.MAIL_TEMPLATE_CODE = exports.LOCAL_DELIVERY_TEMPLATE_CODE = exports.EMPLOYEE_PICKUP_TEMPLATE_CODE = exports.PICKUP_POINT_TEMPLATE_CODE = exports.STORE_PICKUP_TEMPLATE_CODE = exports.STORE_PICKUP_METHOD_CODE = exports.DEFAULT_STORE = exports.DefaultDataService = exports.OFFICIAL_ROLE_TEMPLATES = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const constants_1 = require("../constants");
const payment_profile_service_1 = require("../payment/payment-profile.service");
const pickup_location_entity_1 = require("../pickup/pickup-location.entity");
const shipping_profile_service_1 = require("../shipping/shipping-profile.service");
const shipping_template_entity_1 = require("../shipping/shipping-template.entity");
const shipping_template_service_1 = require("../shipping/shipping-template.service");
const payment_template_entity_1 = require("../payment/payment-template.entity");
const payment_template_service_1 = require("../payment/payment-template.service");
const tenant_member_entity_1 = require("../tenant/tenant-member.entity");
const role_templates_1 = require("../tenant/role-templates");
Object.defineProperty(exports, "OFFICIAL_ROLE_TEMPLATES", { enumerable: true, get: function () { return role_templates_1.OFFICIAL_ROLE_TEMPLATES; } });
const seed_steps_1 = require("./seed-steps");
/**
 * 插件默认数据初始化
 *
 * 商品级配送/支付方案（ShippingProfile/PaymentProfile）建表后为空。
 * 本服务在 onApplicationBootstrap 阶段幂等创建一套全局默认数据，便于快速投入使用：
 * - 自提点（门店）
 * - 门店自提配送方式 + 配送模板 + 配送档案
 * - 门店收银支付方式 + 支付档案
 *
 * 默认数据均为全局档案（isGlobal=true），所有租户共享。
 * 通过 CjkPlugin.options.seedDefaultData = false 可禁用。
 */
let DefaultDataService = class DefaultDataService {
    constructor(connection, requestContextService, shippingMethodService, paymentMethodService, shippingTemplateService, shippingProfileService, paymentProfileService, paymentTemplateService) {
        this.connection = connection;
        this.requestContextService = requestContextService;
        this.shippingMethodService = shippingMethodService;
        this.paymentMethodService = paymentMethodService;
        this.shippingTemplateService = shippingTemplateService;
        this.shippingProfileService = shippingProfileService;
        this.paymentProfileService = paymentProfileService;
        this.paymentTemplateService = paymentTemplateService;
    }
    /**
     * 幂等创建默认数据。
     *
     * 每个步骤独立执行（见 runSeedSteps）：单步失败只记录步骤名与错误，继续执行后续步骤，
     * 最后汇总一条日志列出失败步骤。这样「全局配送档案」这类需要 SuperAdmin 的步骤失败时，
     * 不会再把官方租户播种等关键步骤一起作废。
     */
    async seed() {
        var _a;
        let ctx;
        try {
            ctx = await this.createSeedContext();
        }
        catch (e) {
            core_1.Logger.error(`默认数据初始化中止：播种上下文创建失败: ${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`, constants_1.loggerCtx);
            return;
        }
        core_1.Logger.info('开始初始化购物配送/支付默认数据', constants_1.loggerCtx);
        await (0, seed_steps_1.runSeedSteps)(ctx, [
            { name: '默认自提点', run: c => this.seedPickupLocation(c) },
            { name: '门店自提配送方式', run: c => this.seedStorePickupMethod(c) },
            { name: '门店自提配送模板', run: c => this.seedStorePickupTemplate(c) },
            { name: '门店自提配送档案', run: c => this.seedStorePickupProfile(c) },
            { name: '门店收银支付方式', run: c => this.seedCashierPaymentMethod(c) },
            { name: '门店收银支付档案', run: c => this.seedCashierPaymentProfile(c) },
            // 全局方案池：配送模板（自提点/职工自提/同城/邮寄）
            { name: '自提点配送模板', run: c => this.seedPickupPointTemplate(c) },
            { name: '职工自提配送模板', run: c => this.seedEmployeePickupTemplate(c) },
            { name: '同城配送模板', run: c => this.seedLocalDeliveryTemplate(c) },
            { name: '邮寄配送模板', run: c => this.seedMailTemplate(c) },
            // 全局方案池：支付模板（货到付款/余额支付/聚合码）
            { name: '货到付款支付模板', run: c => this.seedCashOnDeliveryPaymentTemplate(c) },
            { name: '余额支付模板', run: c => this.seedBalancePayPaymentTemplate(c) },
            { name: '聚合码支付模板', run: c => this.seedAggregatePaymentTemplate(c) },
            { name: '固定聚合码支付模板', run: c => this.seedFixedAggregatePaymentTemplate(c) },
            // 前 20 个官方自营租户（幂等，写入前检测 tenantNo 占用）
            { name: '官方自营租户 1-20', run: c => this.seedOfficialTenants(c) },
            // 为官方内置角色补齐 Authenticated 权限（幂等）
            { name: '官方角色 Authenticated 权限', run: c => this.ensureOfficialRolesAuthenticated(c) },
            // 按角色模板补齐存量角色权限（模板新增权限时同步到存量角色，幂等、只增不减）
            { name: '存量角色权限同步', run: c => this.syncRolePermissionsFromTemplates(c) },
            // 修复历史破损官方管理员（补齐 user+authentication_method 使可登录；幂等）
            { name: '破损官方管理员修复', run: c => this.repairOfficialAdminAccounts(c) },
        ]);
    }
    /**
     * 播种上下文：优先带「超管用户」，而不是裸 admin ctx。
     *
     * 原因：全局档案（isGlobal=true）的 create/update/delete 会被
     * assertProfileGlobalPermissions（shipping-profile.service.ts）要求 SuperAdmin 权限，
     * 而 RequestContextService.create({ apiType: 'admin' }) 不带 session user，
     * ctx.userHasPermissions([Permission.SuperAdmin]) 恒为 false —— 这正是本库
     * seedStorePickupProfile 抛「仅超级管理员可创建全局档案」、并连带阻断官方租户播种的根因。
     *
     * 找不到超管角色/用户时退回原行为（只警告，不阻断启动），后续步骤由 runSeedSteps 隔离。
     */
    async createSeedContext() {
        var _a;
        const fallback = async () => {
            core_1.Logger.warn('未找到可用的超级管理员上下文，默认数据中的全局档案步骤可能失败', constants_1.loggerCtx);
            return this.requestContextService.create({ apiType: 'admin' });
        };
        try {
            const { User, Role } = await this.ensureCoreEntities(['User', 'Role']);
            const roleRepo = this.connection.rawConnection.getRepository(Role);
            const roles = await roleRepo.find({ relations: ['channels'] });
            const superRole = roles.find(r => (r.permissions || []).includes(core_1.Permission.SuperAdmin));
            if (!superRole)
                return fallback();
            const userRepo = this.connection.rawConnection.getRepository(User);
            const users = await userRepo.find({ relations: ['roles', 'roles.channels'], take: 200 });
            const superUser = users.find(u => (u.roles || []).some((r) => String(r.id) === String(superRole.id)));
            if (!superUser)
                return fallback();
            return await this.requestContextService.create({ apiType: 'admin', user: superUser });
        }
        catch (e) {
            core_1.Logger.warn(`播种上下文构建失败（${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}），退回无用户上下文`, constants_1.loggerCtx);
            return fallback();
        }
    }
    /** 默认门店自提点 */
    async seedPickupLocation(ctx) {
        const existing = await this.connection
            .getRepository(ctx, pickup_location_entity_1.PickupLocation)
            .findOne({ where: { name: exports.DEFAULT_STORE.name } });
        if (existing)
            return;
        const repo = this.connection.getRepository(ctx, pickup_location_entity_1.PickupLocation);
        const location = new pickup_location_entity_1.PickupLocation(Object.assign(Object.assign({}, exports.DEFAULT_STORE), { isPublic: true, ownerChannelId: null }));
        location.channels = [ctx.channel];
        await repo.save(location);
        core_1.Logger.info(`已创建默认自提点: ${exports.DEFAULT_STORE.name}`, constants_1.loggerCtx);
    }
    /** 门店自提配送方式 */
    async seedStorePickupMethod(ctx) {
        const existing = await this.connection
            .getRepository(ctx, 'ShippingMethod')
            .findOne({ where: { code: exports.STORE_PICKUP_METHOD_CODE } });
        if (existing)
            return;
        await this.shippingMethodService.create(ctx, {
            code: exports.STORE_PICKUP_METHOD_CODE,
            fulfillmentHandler: 'store-pickup',
            checker: { code: 'store-pickup-eligibility', arguments: [] },
            calculator: { code: 'store-pickup-calculator', arguments: [] },
            translations: [
                { languageCode: core_1.LanguageCode.zh_Hans, name: '门店自提', description: '到指定门店自提商品' },
                { languageCode: core_1.LanguageCode.en, name: 'Store Pickup', description: 'Pick up at the store' },
            ],
        });
        core_1.Logger.info(`已创建默认配送方式: ${exports.STORE_PICKUP_METHOD_CODE}`, constants_1.loggerCtx);
    }
    /** 门店自提配送模板 */
    async seedStorePickupTemplate(ctx) {
        const existing = await this.connection
            .getRepository(ctx, shipping_template_entity_1.ShippingTemplate)
            .findOne({ where: { code: exports.STORE_PICKUP_TEMPLATE_CODE } });
        if (existing)
            return;
        await this.shippingTemplateService.create(ctx, {
            name: '门店自提模板',
            description: '到指定门店自提',
            code: exports.STORE_PICKUP_TEMPLATE_CODE,
            fulfillmentHandler: 'store-pickup',
            checker: { code: 'store-pickup-eligibility', arguments: [] },
            calculator: { code: 'store-pickup-calculator', arguments: [] },
            isGlobal: true,
        });
        core_1.Logger.info(`已创建默认配送模板: ${exports.STORE_PICKUP_TEMPLATE_CODE}`, constants_1.loggerCtx);
    }
    /** 门店自提配送档案（关联配送方式 + 自提点） */
    async seedStorePickupProfile(ctx) {
        const existing = await this.shippingProfileService.findByCode(ctx, exports.STORE_PICKUP_PROFILE_CODE);
        if (existing)
            return;
        const method = await this.connection
            .getRepository(ctx, 'ShippingMethod')
            .findOne({ where: { code: exports.STORE_PICKUP_METHOD_CODE } });
        const location = await this.connection
            .getRepository(ctx, pickup_location_entity_1.PickupLocation)
            .findOne({ where: { name: exports.DEFAULT_STORE.name } });
        if (!method) {
            core_1.Logger.warn(`配送方式 ${exports.STORE_PICKUP_METHOD_CODE} 不存在，跳过配送档案`, constants_1.loggerCtx);
            return;
        }
        await this.shippingProfileService.create(ctx, {
            name: '门店自提配送档案',
            description: '到指定门店自提',
            code: exports.STORE_PICKUP_PROFILE_CODE,
            isGlobal: true,
            shippingMethodIds: [method.id],
            pickupLocationIds: location ? [location.id] : [],
        });
        core_1.Logger.info(`已创建默认配送档案: ${exports.STORE_PICKUP_PROFILE_CODE}`, constants_1.loggerCtx);
    }
    /** 门店收银支付方式（货到付款处理器） */
    async seedCashierPaymentMethod(ctx) {
        const existing = await this.connection
            .getRepository(ctx, 'PaymentMethod')
            .findOne({ where: { code: exports.CASHIER_PAYMENT_METHOD_CODE } });
        if (existing)
            return;
        await this.paymentMethodService.create(ctx, {
            code: exports.CASHIER_PAYMENT_METHOD_CODE,
            enabled: true,
            handler: { code: 'cash-on-delivery', arguments: [] },
            translations: [
                { languageCode: core_1.LanguageCode.zh_Hans, name: '门店收银', description: '到店扫码/收银台支付' },
                { languageCode: core_1.LanguageCode.en, name: 'Store Cashier', description: 'Pay at the store cashier' },
            ],
        });
        core_1.Logger.info(`已创建默认支付方式: ${exports.CASHIER_PAYMENT_METHOD_CODE}`, constants_1.loggerCtx);
    }
    /** 门店收银支付档案 */
    async seedCashierPaymentProfile(ctx) {
        const existing = await this.paymentProfileService.findByCode(ctx, exports.CASHIER_PAYMENT_PROFILE_CODE);
        if (existing)
            return;
        const method = await this.connection
            .getRepository(ctx, 'PaymentMethod')
            .findOne({ where: { code: exports.CASHIER_PAYMENT_METHOD_CODE } });
        if (!method) {
            core_1.Logger.warn(`支付方式 ${exports.CASHIER_PAYMENT_METHOD_CODE} 不存在，跳过支付档案`, constants_1.loggerCtx);
            return;
        }
        await this.paymentProfileService.create(ctx, {
            name: '门店收银支付档案',
            description: '到店收银台支付',
            code: exports.CASHIER_PAYMENT_PROFILE_CODE,
            isGlobal: true,
            paymentMethodIds: [method.id],
        });
        core_1.Logger.info(`已创建默认支付档案: ${exports.CASHIER_PAYMENT_PROFILE_CODE}`, constants_1.loggerCtx);
    }
    /** 自提点配送全局模板（固定运费，租户引用后在实例上配 shippingPrice） */
    async seedPickupPointTemplate(ctx) {
        if (await this.shippingTemplateExists(ctx, exports.PICKUP_POINT_TEMPLATE_CODE))
            return;
        await this.shippingTemplateService.create(ctx, {
            name: '自提点配送',
            description: '到指定自提点取货，固定运费',
            code: exports.PICKUP_POINT_TEMPLATE_CODE,
            fulfillmentHandler: 'pickup-point',
            checker: { code: 'pickup-point-eligibility', arguments: [] },
            calculator: { code: 'pickup-point-calculator', arguments: [] },
            isGlobal: true,
        });
        core_1.Logger.info(`已创建默认配送模板: ${exports.PICKUP_POINT_TEMPLATE_CODE}`, constants_1.loggerCtx);
    }
    /** 职工单位自提配送全局模板（固定运费） */
    async seedEmployeePickupTemplate(ctx) {
        if (await this.shippingTemplateExists(ctx, exports.EMPLOYEE_PICKUP_TEMPLATE_CODE))
            return;
        await this.shippingTemplateService.create(ctx, {
            name: '职工单位自提',
            description: '送达职工单位自提点，固定运费',
            code: exports.EMPLOYEE_PICKUP_TEMPLATE_CODE,
            fulfillmentHandler: 'employee-pickup',
            checker: { code: 'employee-pickup-eligibility', arguments: [] },
            calculator: { code: 'employee-pickup-calculator', arguments: [] },
            isGlobal: true,
        });
        core_1.Logger.info(`已创建默认配送模板: ${exports.EMPLOYEE_PICKUP_TEMPLATE_CODE}`, constants_1.loggerCtx);
    }
    /** 同城快递配送全局模板（固定运费） */
    async seedLocalDeliveryTemplate(ctx) {
        if (await this.shippingTemplateExists(ctx, exports.LOCAL_DELIVERY_TEMPLATE_CODE))
            return;
        await this.shippingTemplateService.create(ctx, {
            name: '同城快递',
            description: '同城当日/次日达，固定运费',
            code: exports.LOCAL_DELIVERY_TEMPLATE_CODE,
            fulfillmentHandler: 'manual-fulfillment',
            checker: { code: 'tiered-shipping-eligibility-checker', arguments: [] },
            calculator: { code: 'local-delivery-calculator', arguments: [] },
            isGlobal: true,
        });
        core_1.Logger.info(`已创建默认配送模板: ${exports.LOCAL_DELIVERY_TEMPLATE_CODE}`, constants_1.loggerCtx);
    }
    /** 邮寄配送全局模板（阶梯重量/件数计费） */
    async seedMailTemplate(ctx) {
        if (await this.shippingTemplateExists(ctx, exports.MAIL_TEMPLATE_CODE))
            return;
        await this.shippingTemplateService.create(ctx, {
            name: '邮寄配送',
            description: '全国邮寄，按重量/件数阶梯计费',
            code: exports.MAIL_TEMPLATE_CODE,
            fulfillmentHandler: 'manual-fulfillment',
            checker: { code: 'tiered-shipping-eligibility-checker', arguments: [] },
            calculator: { code: 'tiered-weight-shipping-calculator', arguments: [] },
            isGlobal: true,
        });
        core_1.Logger.info(`已创建默认配送模板: ${exports.MAIL_TEMPLATE_CODE}`, constants_1.loggerCtx);
    }
    async shippingTemplateExists(ctx, code) {
        const t = await this.connection
            .getRepository(ctx, shipping_template_entity_1.ShippingTemplate)
            .findOne({ where: { code } });
        return !!t;
    }
    /** 货到付款支付全局模板 */
    async seedCashOnDeliveryPaymentTemplate(ctx) {
        if (await this.paymentTemplateExists(ctx, exports.COD_PAYMENT_TEMPLATE_CODE))
            return;
        await this.paymentTemplateService.create(ctx, {
            name: '货到付款',
            description: '货到验货后付款',
            code: exports.COD_PAYMENT_TEMPLATE_CODE,
            handler: { code: 'cash-on-delivery', arguments: [] },
            isGlobal: true,
        });
        core_1.Logger.info(`已创建默认支付模板: ${exports.COD_PAYMENT_TEMPLATE_CODE}`, constants_1.loggerCtx);
    }
    /** 余额支付全局模板 */
    async seedBalancePayPaymentTemplate(ctx) {
        if (await this.paymentTemplateExists(ctx, exports.BALANCE_PAY_TEMPLATE_CODE))
            return;
        await this.paymentTemplateService.create(ctx, {
            name: '余额支付',
            description: '使用账户余额支付（全局共享钱包）',
            code: exports.BALANCE_PAY_TEMPLATE_CODE,
            handler: { code: 'balance-wallet', arguments: [] },
            isGlobal: true,
        });
        core_1.Logger.info(`已创建默认支付模板: ${exports.BALANCE_PAY_TEMPLATE_CODE}`, constants_1.loggerCtx);
    }
    async paymentTemplateExists(ctx, code) {
        const t = await this.connection
            .getRepository(ctx, payment_template_entity_1.PaymentTemplate)
            .findOne({ where: { code } });
        return !!t;
    }
    /** 聚合码支付全局模板（租户可在全局方案池「引用到本店」） */
    async seedAggregatePaymentTemplate(ctx) {
        const existing = await this.connection
            .getRepository(ctx, payment_template_entity_1.PaymentTemplate)
            .findOne({ where: { code: exports.AGGREGATE_PAYMENT_TEMPLATE_CODE } });
        if (existing)
            return;
        await this.paymentTemplateService.create(ctx, {
            name: '聚合码',
            description: '顾客扫描商家聚合收款码后确认，到账后发货',
            code: exports.AGGREGATE_PAYMENT_TEMPLATE_CODE,
            handler: { code: 'aggregate-pay', arguments: [] },
            isGlobal: true,
        });
        core_1.Logger.info(`已创建默认支付模板: ${exports.AGGREGATE_PAYMENT_TEMPLATE_CODE}`, constants_1.loggerCtx);
    }
    /** 固定聚合码收款支付全局模板（门店到店收银，租户可在全局方案池「引用到本店」） */
    async seedFixedAggregatePaymentTemplate(ctx) {
        const existing = await this.connection
            .getRepository(ctx, payment_template_entity_1.PaymentTemplate)
            .findOne({ where: { code: exports.FIXED_AGGREGATE_COLLECTION_TEMPLATE_CODE } });
        if (existing)
            return;
        await this.paymentTemplateService.create(ctx, {
            name: '固定聚合码收款',
            description: '门店到店收银：顾客扫门店固定聚合收款码付款到商户，店员确认到账后完成订单',
            code: exports.FIXED_AGGREGATE_COLLECTION_TEMPLATE_CODE,
            handler: { code: 'fixed-aggregate-collection', arguments: [] },
            isGlobal: true,
        });
        core_1.Logger.info(`已创建默认支付模板: ${exports.FIXED_AGGREGATE_COLLECTION_TEMPLATE_CODE}`, constants_1.loggerCtx);
    }
    /**
     * 幂等创建前 20 个官方自营租户（tenantNo 1-20，isOfficial=true）。
     * 每个租户：3 个内置角色（租户管理员/销售/库存）+ 默认管理员 admin
     *            + 门店自提配送方式 + 门店收银支付方式（复用全局 handler）。
     * 已存在（按 channel.code 判重）则跳过。
     */
    async seedOfficialTenants(ctx) {
        const { Channel, Role } = await this.ensureCoreEntities(['Channel', 'Role']);
        const channelRepo = this.connection.getRepository(ctx, Channel);
        const roleRepo = this.connection.getRepository(ctx, Role);
        // tenantNo 在数据库上没有唯一约束：业务租户（如 t1）可能已经占用了 1..20 的号位，
        // 直接写入会静默出现两个渠道同号。故先一次性载入现有渠道做占用检测。
        const existingChannels = await channelRepo.find({});
        for (let i = 1; i <= 20; i++) {
            const code = `official-${String(i).padStart(2, '0')}`;
            const token = `official-${i}`;
            // 按 code 或 token 任一命中即视为已存在：历史数据中存在 code 被改过
            // （如 official-20 改名 limin）但 token 仍占用的情况，只按 code 判重会撞 token 唯一键
            const exists = await channelRepo.findOne({ where: [{ code }, { token }] });
            if (exists) {
                core_1.Logger.info(`官方自营租户 ${code} 已存在，跳过`, constants_1.loggerCtx);
                continue;
            }
            const occupant = (0, seed_steps_1.findTenantNoOccupant)(existingChannels, i);
            if (occupant) {
                if (occupant.isOfficial) {
                    core_1.Logger.warn(`官方位 ${i} 已被官方渠道 ${occupant.code} 占用（tenantNo=${i}），跳过创建 ${code}`, constants_1.loggerCtx);
                }
                else {
                    core_1.Logger.error(`tenantNo=${i} 已被非官方渠道占用（code=${occupant.code}），跳过官方位 ${i}`, constants_1.loggerCtx);
                }
                continue;
            }
            const channel = await channelRepo.save(new Channel({
                code,
                token,
                defaultLanguageCode: core_1.LanguageCode.zh_Hans,
                defaultCurrencyCode: 'CNY',
                pricesIncludeTax: true,
                customFields: {
                    enabled: true,
                    tenantNo: i,
                    isOfficial: true,
                    shopName: `官方自营${String(i).padStart(2, '0')}`,
                },
            }));
            existingChannels.push(channel);
            core_1.Logger.info(`已创建官方自营租户 ${code}`, constants_1.loggerCtx);
            // 3 个内置角色（限定该 channel；权限清单来自单一模板）
            const [tenantAdminRole, salesRole, stockRole] = await Promise.all(role_templates_1.OFFICIAL_ROLE_TEMPLATES.map((tpl) => this.createTenantRoleRecord(ctx, roleRepo, channel, `official-${tpl.busiPrefix}-${i}`, tpl.description, tpl.permissions)));
            // 默认管理员 admin（完善 user + 原生认证 + 绑定租户管理员角色，否则账号无法登录）
            await this.createOfficialAdminWithAccount(ctx, channel, tenantAdminRole, i);
            try {
                await this.shippingMethodService.create(ctx, {
                    code: `store-pickup-${code}`,
                    fulfillmentHandler: 'store-pickup',
                    checker: { code: 'store-pickup-eligibility', arguments: [] },
                    calculator: { code: 'store-pickup-calculator', arguments: [] },
                    translations: [{ languageCode: core_1.LanguageCode.zh_Hans, name: '门店自提', description: '到指定门店自提商品' }],
                    channels: [channel],
                });
                await this.paymentMethodService.create(ctx, {
                    code: `cashier-${code}`,
                    enabled: true,
                    handler: { code: 'cash-on-delivery', arguments: [] },
                    translations: [{ languageCode: core_1.LanguageCode.zh_Hans, name: '门店收银', description: '到店收银台支付' }],
                    channels: [channel],
                });
            }
            catch (e) {
                core_1.Logger.warn(`官方租户 ${code} 履约初始化失败: ${e.message}`, constants_1.loggerCtx);
            }
        }
    }
    /**
     * 官方管理员账号完整建链：NativeAuthenticationMethod(user+auth) → User(绑定角色) → Administrator(挂 user) → TenantMember。
     * 直接 save Administrator 不会生成 vendure 认证链路（user/authentication_method），导致账号无法登录。
     */
    async createOfficialAdminWithAccount(ctx, channel, role, i) {
        const { Administrator, User, NativeAuthenticationMethod } = await this.ensureCoreEntities([
            'Administrator',
            'User',
            'NativeAuthenticationMethod',
        ]);
        const adminRepo = this.connection.getRepository(ctx, Administrator);
        const userRepo = this.connection.getRepository(ctx, User);
        const authRepo = this.connection.getRepository(ctx, NativeAuthenticationMethod);
        const memberRepo = this.connection.getRepository(ctx, tenant_member_entity_1.TenantMember);
        const code = `official-${String(i).padStart(2, '0')}`;
        // 约定账号命名统一补零两位（与渠道 code 一致），如 admin-official-01@local.dev
        const email = `admin-official-${String(i).padStart(2, '0')}@local.dev`;
        const auth = await authRepo.save(new NativeAuthenticationMethod({
            identifier: email,
            passwordHash: await this.hashPassword('Admin@123456'),
        }));
        const user = await userRepo.save(new User({
            identifier: email,
            verified: true,
            authenticationMethods: [auth],
            roles: role ? [role] : [],
        }));
        const admin = await adminRepo.save(new Administrator({
            firstName: '官方自营',
            lastName: code,
            emailAddress: email,
            user,
        }));
        await memberRepo.save(new tenant_member_entity_1.TenantMember({
            administratorId: String(admin.id),
            channelId: String(channel.id),
            enabled: true,
            displayName: `官方自营${String(i).padStart(2, '0')}管理员`,
            remark: 'seed 默认管理员',
            shippingProfileIds: [],
        }));
    }
    /** 修复历史破损官方管理员：此前直存 Administrator 未建 user/auth，现补齐使其可登录。
     *  幂等：user 已存在则跳过；破损则删旧 Admin + 其 TenantMember，再用正确链路重建。 */
    async repairOfficialAdminAccounts(ctx) {
        const { Administrator, Channel, Role } = await this.ensureCoreEntities(['Administrator', 'Channel', 'Role']);
        const adminRepo = this.connection.getRepository(ctx, Administrator);
        const channelRepo = this.connection.getRepository(ctx, Channel);
        const roleRepo = this.connection.getRepository(ctx, Role);
        const memberRepo = this.connection.getRepository(ctx, tenant_member_entity_1.TenantMember);
        let repaired = 0;
        for (let i = 1; i <= 20; i++) {
            const code = `official-${String(i).padStart(2, '0')}`;
            const email = `admin-official-${i}@local.dev`;
            const admin = await adminRepo.findOne({
                where: { emailAddress: email },
                relations: ['user'],
            });
            if (!admin)
                continue;
            if (admin.user)
                continue; // 已就绪
            const channel = await channelRepo.findOne({ where: { code } });
            if (!channel) {
                core_1.Logger.warn(`修复官方管理员: 租户 ${code} 不存在，跳过`, constants_1.loggerCtx);
                continue;
            }
            const role = await roleRepo.findOne({ where: { code: `official-tenant-admin-${i}` } });
            const oldId = String(admin.id);
            await memberRepo.delete({ administratorId: oldId });
            await adminRepo.remove(admin);
            await this.createOfficialAdminWithAccount(ctx, channel, role, i);
            repaired++;
        }
        if (repaired) {
            core_1.Logger.info(`已修复 ${repaired} 个官方管理员登录账号（补齐 user+authentication_method）`, constants_1.loggerCtx);
        }
    }
    /** 为已存在的官方内置角色补齐 Authenticated 权限（历史种子直存 Role 遗漏该权限），否则过期账号登录被拒。幂等。 */
    async ensureOfficialRolesAuthenticated(ctx) {
        const { Role } = await this.ensureCoreEntities(['Role']);
        const roleRepo = this.connection.getRepository(ctx, Role);
        let fixed = 0;
        for (let i = 1; i <= 20; i++) {
            for (const busi of role_templates_1.OFFICIAL_ROLE_TEMPLATES.map((t) => t.busiPrefix)) {
                const code = `official-${busi}-${i}`;
                const role = await roleRepo.findOne({ where: { code } });
                if (!role)
                    continue;
                const perms = role.permissions || [];
                if (perms.includes(core_1.Permission.Authenticated))
                    continue;
                role.permissions = Array.from(new Set([core_1.Permission.Authenticated, ...perms]));
                await roleRepo.save(role);
                fixed++;
            }
        }
        if (fixed) {
            core_1.Logger.info(`已为 ${fixed} 个官方角色补齐 Authenticated 权限`, constants_1.loggerCtx);
        }
    }
    /**
     * 按角色模板补齐存量角色权限：模板新增权限（如租户网点管理所需的 CreateStockLocation 等）时，
     * 已存在的租户角色自动同步。幂等且只增不减（不删除角色现有权限），避免覆盖租户定制。
     * 匹配范围：official-tenant-admin-N（官方 seed 角色）与 tN-tenant-admin / tN-sales / tN-stock（租户角色）。
     */
    async syncRolePermissionsFromTemplates(ctx) {
        const { Role } = await this.ensureCoreEntities(['Role']);
        const roleRepo = this.connection.getRepository(ctx, Role);
        const all = await roleRepo.find({});
        let fixed = 0;
        for (const role of all) {
            const code = role.code || '';
            const tpl = role_templates_1.OFFICIAL_ROLE_TEMPLATES.find((t) => {
                if (code === t.busiPrefix || code === `official-${t.busiPrefix}`)
                    return true;
                // 官方 seed 角色：official-tenant-admin-N
                if (new RegExp(`^official-${t.busiPrefix}-\\d+$`).test(code))
                    return true;
                // 租户角色：tN-tenant-admin / tN-sales / tN-stock
                if (new RegExp(`^t\\d+-${t.busiPrefix}$`).test(code))
                    return true;
                return false;
            });
            if (!tpl)
                continue;
            const cur = role.permissions || [];
            const missing = tpl.permissions.filter((p) => !cur.includes(p));
            if (!missing.length)
                continue;
            role.permissions = Array.from(new Set([...cur, ...tpl.permissions]));
            await roleRepo.save(role);
            fixed++;
        }
        if (fixed) {
            core_1.Logger.info(`已为 ${fixed} 个租户角色按模板补齐权限（含 StockLocation 网点管理）`, constants_1.loggerCtx);
        }
    }
    /** 延迟加载 Vendure 核心实体，避免 seed 阶段循环依赖 */
    async ensureCoreEntities(names) {
        const core = await import('@vendure/core');
        const result = {};
        for (const name of names)
            result[name] = core[name];
        return result;
    }
    async createTenantRoleRecord(ctx, roleRepo, channel, code, description, permissions) {
        const { Role } = await this.ensureCoreEntities(['Role']);
        // 官方链路必须含 Authenticated，否则管理员登录后任何 @Allow(Authenticated) 查询都会被拒
        const perms = Array.from(new Set([core_1.Permission.Authenticated, ...permissions]));
        const role = new Role({ code, description, permissions: perms, channels: [channel] });
        return roleRepo.save(role);
    }
    async hashPassword(plain) {
        const { BcryptPasswordHashingStrategy } = await import('@vendure/core');
        const s = new BcryptPasswordHashingStrategy();
        return s.hash(plain);
    }
};
exports.DefaultDataService = DefaultDataService;
exports.DefaultDataService = DefaultDataService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection,
        core_1.RequestContextService,
        core_1.ShippingMethodService,
        core_1.PaymentMethodService,
        shipping_template_service_1.ShippingTemplateService,
        shipping_profile_service_1.ShippingProfileService,
        payment_profile_service_1.PaymentProfileService,
        payment_template_service_1.PaymentTemplateService])
], DefaultDataService);
exports.DEFAULT_STORE = {
    name: '自由大路店',
    type: 'store',
    address: '自由大路',
    phoneNumber: '',
    businessHours: '09:00-21:00',
};
exports.STORE_PICKUP_METHOD_CODE = 'store-pickup';
exports.STORE_PICKUP_TEMPLATE_CODE = 'store-pickup-template';
exports.PICKUP_POINT_TEMPLATE_CODE = 'pickup-point-template';
exports.EMPLOYEE_PICKUP_TEMPLATE_CODE = 'employee-pickup-template';
exports.LOCAL_DELIVERY_TEMPLATE_CODE = 'local-delivery-template';
exports.MAIL_TEMPLATE_CODE = 'mail-template';
exports.STORE_PICKUP_PROFILE_CODE = 'store-pickup-profile';
exports.CASHIER_PAYMENT_METHOD_CODE = 'cash-on-delivery';
exports.CASHIER_PAYMENT_PROFILE_CODE = 'store-cashier-profile';
exports.COD_PAYMENT_TEMPLATE_CODE = 'cod-payment-template';
exports.BALANCE_PAY_TEMPLATE_CODE = 'balance-pay-template';
exports.AGGREGATE_PAYMENT_TEMPLATE_CODE = 'aggregate-pay';
exports.FIXED_AGGREGATE_COLLECTION_TEMPLATE_CODE = 'fixed-aggregate-collection';
//# sourceMappingURL=default-data.service.js.map