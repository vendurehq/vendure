import { Injectable } from '@nestjs/common';
import {
    ID,
    LanguageCode,
    Logger,
    PaymentMethodService,
    Permission,
    RequestContext,
    RequestContextService,
    ShippingMethodService,
    TransactionalConnection,
} from '@vendure/core';

import { loggerCtx } from '../constants';
import { PaymentProfile } from '../payment/payment-profile.entity';
import { PaymentProfileService } from '../payment/payment-profile.service';
import { PickupLocation } from '../pickup/pickup-location.entity';
import { ShippingProfile } from '../shipping/shipping-profile.entity';
import { ShippingProfileService } from '../shipping/shipping-profile.service';
import { ShippingTemplate } from '../shipping/shipping-template.entity';
import { ShippingTemplateService } from '../shipping/shipping-template.service';

import { PaymentTemplate } from '../payment/payment-template.entity';
import { PaymentTemplateService } from '../payment/payment-template.service';
import { TenantMember } from '../tenant/tenant-member.entity';
import { OFFICIAL_ROLE_TEMPLATES, RoleTemplate } from '../tenant/role-templates';
import { findTenantNoOccupant, runSeedSteps } from './seed-steps';

export { OFFICIAL_ROLE_TEMPLATES, RoleTemplate };

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
@Injectable()
export class DefaultDataService {
    constructor(
        private connection: TransactionalConnection,
        private requestContextService: RequestContextService,
        private shippingMethodService: ShippingMethodService,
        private paymentMethodService: PaymentMethodService,
        private shippingTemplateService: ShippingTemplateService,
        private shippingProfileService: ShippingProfileService,
        private paymentProfileService: PaymentProfileService,
        private paymentTemplateService: PaymentTemplateService,
    ) {}

    /**
     * 幂等创建默认数据。
     *
     * 每个步骤独立执行（见 runSeedSteps）：单步失败只记录步骤名与错误，继续执行后续步骤，
     * 最后汇总一条日志列出失败步骤。这样「全局配送档案」这类需要 SuperAdmin 的步骤失败时，
     * 不会再把官方租户播种等关键步骤一起作废。
     */
    async seed(): Promise<void> {
        let ctx: RequestContext;
        try {
            ctx = await this.createSeedContext();
        } catch (e: any) {
            Logger.error(`默认数据初始化中止：播种上下文创建失败: ${e?.message ?? e}`, loggerCtx);
            return;
        }
        Logger.info('开始初始化购物配送/支付默认数据', loggerCtx);
        await runSeedSteps<RequestContext>(ctx, [
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
    private async createSeedContext(): Promise<RequestContext> {
        const fallback = async () => {
            Logger.warn('未找到可用的超级管理员上下文，默认数据中的全局档案步骤可能失败', loggerCtx);
            return this.requestContextService.create({ apiType: 'admin' });
        };
        try {
            const { User, Role } = await this.ensureCoreEntities(['User', 'Role']);
            const roleRepo = this.connection.rawConnection.getRepository(Role);
            const roles: any[] = await roleRepo.find({ relations: ['channels'] });
            const superRole = roles.find(r => (r.permissions || []).includes(Permission.SuperAdmin));
            if (!superRole) return fallback();

            const userRepo = this.connection.rawConnection.getRepository(User);
            const users: any[] = await userRepo.find({ relations: ['roles', 'roles.channels'], take: 200 } as any);
            const superUser = users.find(
                u => (u.roles || []).some((r: any) => String(r.id) === String(superRole.id)),
            );
            if (!superUser) return fallback();

            return await this.requestContextService.create({ apiType: 'admin', user: superUser });
        } catch (e: any) {
            Logger.warn(`播种上下文构建失败（${e?.message ?? e}），退回无用户上下文`, loggerCtx);
            return fallback();
        }
    }

    /** 默认门店自提点 */
    private async seedPickupLocation(ctx: RequestContext): Promise<void> {
        const existing = await this.connection
            .getRepository(ctx, PickupLocation)
            .findOne({ where: { name: DEFAULT_STORE.name } });
        if (existing) return;
        const repo = this.connection.getRepository(ctx, PickupLocation);
        const location = new PickupLocation({
            ...DEFAULT_STORE,
            isPublic: true,
            ownerChannelId: null,
        } as any);
        location.channels = [ctx.channel];
        await repo.save(location);
        Logger.info(`已创建默认自提点: ${DEFAULT_STORE.name}`, loggerCtx);
    }

    /** 门店自提配送方式 */
    private async seedStorePickupMethod(ctx: RequestContext): Promise<void> {
        const existing = await this.connection
            .getRepository(ctx, 'ShippingMethod')
            .findOne({ where: { code: STORE_PICKUP_METHOD_CODE } });
        if (existing) return;
        await this.shippingMethodService.create(ctx, {
            code: STORE_PICKUP_METHOD_CODE,
            fulfillmentHandler: 'store-pickup',
            checker: { code: 'store-pickup-eligibility', arguments: [] },
            calculator: { code: 'store-pickup-calculator', arguments: [] },
            translations: [
                { languageCode: LanguageCode.zh_Hans, name: '门店自提', description: '到指定门店自提商品' },
                { languageCode: LanguageCode.en, name: 'Store Pickup', description: 'Pick up at the store' },
            ],
        } as any);
        Logger.info(`已创建默认配送方式: ${STORE_PICKUP_METHOD_CODE}`, loggerCtx);
    }

    /** 门店自提配送模板 */
    private async seedStorePickupTemplate(ctx: RequestContext): Promise<void> {
        const existing = await this.connection
            .getRepository(ctx, ShippingTemplate)
            .findOne({ where: { code: STORE_PICKUP_TEMPLATE_CODE } });
        if (existing) return;
        await this.shippingTemplateService.create(ctx, {
            name: '门店自提模板',
            description: '到指定门店自提',
            code: STORE_PICKUP_TEMPLATE_CODE,
            fulfillmentHandler: 'store-pickup',
            checker: { code: 'store-pickup-eligibility', arguments: [] },
            calculator: { code: 'store-pickup-calculator', arguments: [] },
            isGlobal: true,
        } as any);
        Logger.info(`已创建默认配送模板: ${STORE_PICKUP_TEMPLATE_CODE}`, loggerCtx);
    }

    /** 门店自提配送档案（关联配送方式 + 自提点） */
    private async seedStorePickupProfile(ctx: RequestContext): Promise<void> {
        const existing = await this.shippingProfileService.findByCode(ctx, STORE_PICKUP_PROFILE_CODE);
        if (existing) return;
        const method = await this.connection
            .getRepository(ctx, 'ShippingMethod')
            .findOne({ where: { code: STORE_PICKUP_METHOD_CODE } });
        const location = await this.connection
            .getRepository(ctx, PickupLocation)
            .findOne({ where: { name: DEFAULT_STORE.name } });
        if (!method) {
            Logger.warn(`配送方式 ${STORE_PICKUP_METHOD_CODE} 不存在，跳过配送档案`, loggerCtx);
            return;
        }
        await this.shippingProfileService.create(ctx, {
            name: '门店自提配送档案',
            description: '到指定门店自提',
            code: STORE_PICKUP_PROFILE_CODE,
            isGlobal: true,
            shippingMethodIds: [method.id],
            pickupLocationIds: location ? [location.id] : [],
        } as any);
        Logger.info(`已创建默认配送档案: ${STORE_PICKUP_PROFILE_CODE}`, loggerCtx);
    }

    /** 门店收银支付方式（货到付款处理器） */
    private async seedCashierPaymentMethod(ctx: RequestContext): Promise<void> {
        const existing = await this.connection
            .getRepository(ctx, 'PaymentMethod')
            .findOne({ where: { code: CASHIER_PAYMENT_METHOD_CODE } });
        if (existing) return;
        await this.paymentMethodService.create(ctx, {
            code: CASHIER_PAYMENT_METHOD_CODE,
            enabled: true,
            handler: { code: 'cash-on-delivery', arguments: [] },
            translations: [
                { languageCode: LanguageCode.zh_Hans, name: '门店收银', description: '到店扫码/收银台支付' },
                { languageCode: LanguageCode.en, name: 'Store Cashier', description: 'Pay at the store cashier' },
            ],
        } as any);
        Logger.info(`已创建默认支付方式: ${CASHIER_PAYMENT_METHOD_CODE}`, loggerCtx);
    }

    /** 门店收银支付档案 */
    private async seedCashierPaymentProfile(ctx: RequestContext): Promise<void> {
        const existing = await this.paymentProfileService.findByCode(ctx, CASHIER_PAYMENT_PROFILE_CODE);
        if (existing) return;
        const method = await this.connection
            .getRepository(ctx, 'PaymentMethod')
            .findOne({ where: { code: CASHIER_PAYMENT_METHOD_CODE } });
        if (!method) {
            Logger.warn(`支付方式 ${CASHIER_PAYMENT_METHOD_CODE} 不存在，跳过支付档案`, loggerCtx);
            return;
        }
        await this.paymentProfileService.create(ctx, {
            name: '门店收银支付档案',
            description: '到店收银台支付',
            code: CASHIER_PAYMENT_PROFILE_CODE,
            isGlobal: true,
            paymentMethodIds: [method.id],
        } as any);
        Logger.info(`已创建默认支付档案: ${CASHIER_PAYMENT_PROFILE_CODE}`, loggerCtx);
    }

    /** 自提点配送全局模板（固定运费，租户引用后在实例上配 shippingPrice） */
    private async seedPickupPointTemplate(ctx: RequestContext): Promise<void> {
        if (await this.shippingTemplateExists(ctx, PICKUP_POINT_TEMPLATE_CODE)) return;
        await this.shippingTemplateService.create(ctx, {
            name: '自提点配送',
            description: '到指定自提点取货，固定运费',
            code: PICKUP_POINT_TEMPLATE_CODE,
            fulfillmentHandler: 'pickup-point',
            checker: { code: 'pickup-point-eligibility', arguments: [] },
            calculator: { code: 'pickup-point-calculator', arguments: [] },
            isGlobal: true,
        } as any);
        Logger.info(`已创建默认配送模板: ${PICKUP_POINT_TEMPLATE_CODE}`, loggerCtx);
    }

    /** 职工单位自提配送全局模板（固定运费） */
    private async seedEmployeePickupTemplate(ctx: RequestContext): Promise<void> {
        if (await this.shippingTemplateExists(ctx, EMPLOYEE_PICKUP_TEMPLATE_CODE)) return;
        await this.shippingTemplateService.create(ctx, {
            name: '职工单位自提',
            description: '送达职工单位自提点，固定运费',
            code: EMPLOYEE_PICKUP_TEMPLATE_CODE,
            fulfillmentHandler: 'employee-pickup',
            checker: { code: 'employee-pickup-eligibility', arguments: [] },
            calculator: { code: 'employee-pickup-calculator', arguments: [] },
            isGlobal: true,
        } as any);
        Logger.info(`已创建默认配送模板: ${EMPLOYEE_PICKUP_TEMPLATE_CODE}`, loggerCtx);
    }

    /** 同城快递配送全局模板（固定运费） */
    private async seedLocalDeliveryTemplate(ctx: RequestContext): Promise<void> {
        if (await this.shippingTemplateExists(ctx, LOCAL_DELIVERY_TEMPLATE_CODE)) return;
        await this.shippingTemplateService.create(ctx, {
            name: '同城快递',
            description: '同城当日/次日达，固定运费',
            code: LOCAL_DELIVERY_TEMPLATE_CODE,
            fulfillmentHandler: 'manual-fulfillment',
            checker: { code: 'tiered-shipping-eligibility-checker', arguments: [] },
            calculator: { code: 'local-delivery-calculator', arguments: [] },
            isGlobal: true,
        } as any);
        Logger.info(`已创建默认配送模板: ${LOCAL_DELIVERY_TEMPLATE_CODE}`, loggerCtx);
    }

    /** 邮寄配送全局模板（阶梯重量/件数计费） */
    private async seedMailTemplate(ctx: RequestContext): Promise<void> {
        if (await this.shippingTemplateExists(ctx, MAIL_TEMPLATE_CODE)) return;
        await this.shippingTemplateService.create(ctx, {
            name: '邮寄配送',
            description: '全国邮寄，按重量/件数阶梯计费',
            code: MAIL_TEMPLATE_CODE,
            fulfillmentHandler: 'manual-fulfillment',
            checker: { code: 'tiered-shipping-eligibility-checker', arguments: [] },
            calculator: { code: 'tiered-weight-shipping-calculator', arguments: [] },
            isGlobal: true,
        } as any);
        Logger.info(`已创建默认配送模板: ${MAIL_TEMPLATE_CODE}`, loggerCtx);
    }

    private async shippingTemplateExists(ctx: RequestContext, code: string): Promise<boolean> {
        const t = await this.connection
            .getRepository(ctx, ShippingTemplate)
            .findOne({ where: { code } });
        return !!t;
    }

    /** 货到付款支付全局模板 */
    private async seedCashOnDeliveryPaymentTemplate(ctx: RequestContext): Promise<void> {
        if (await this.paymentTemplateExists(ctx, COD_PAYMENT_TEMPLATE_CODE)) return;
        await this.paymentTemplateService.create(ctx, {
            name: '货到付款',
            description: '货到验货后付款',
            code: COD_PAYMENT_TEMPLATE_CODE,
            handler: { code: 'cash-on-delivery', arguments: [] },
            isGlobal: true,
        } as any);
        Logger.info(`已创建默认支付模板: ${COD_PAYMENT_TEMPLATE_CODE}`, loggerCtx);
    }

    /** 余额支付全局模板 */
    private async seedBalancePayPaymentTemplate(ctx: RequestContext): Promise<void> {
        if (await this.paymentTemplateExists(ctx, BALANCE_PAY_TEMPLATE_CODE)) return;
        await this.paymentTemplateService.create(ctx, {
            name: '余额支付',
            description: '使用账户余额支付（全局共享钱包）',
            code: BALANCE_PAY_TEMPLATE_CODE,
            handler: { code: 'balance-wallet', arguments: [] },
            isGlobal: true,
        } as any);
        Logger.info(`已创建默认支付模板: ${BALANCE_PAY_TEMPLATE_CODE}`, loggerCtx);
    }

    private async paymentTemplateExists(ctx: RequestContext, code: string): Promise<boolean> {
        const t = await this.connection
            .getRepository(ctx, PaymentTemplate)
            .findOne({ where: { code } });
        return !!t;
    }

    /** 聚合码支付全局模板（租户可在全局方案池「引用到本店」） */
    private async seedAggregatePaymentTemplate(ctx: RequestContext): Promise<void> {
        const existing = await this.connection
            .getRepository(ctx, PaymentTemplate)
            .findOne({ where: { code: AGGREGATE_PAYMENT_TEMPLATE_CODE } });
        if (existing) return;
        await this.paymentTemplateService.create(ctx, {
            name: '聚合码',
            description: '顾客扫描商家聚合收款码后确认，到账后发货',
            code: AGGREGATE_PAYMENT_TEMPLATE_CODE,
            handler: { code: 'aggregate-pay', arguments: [] },
            isGlobal: true,
        } as any);
        Logger.info(`已创建默认支付模板: ${AGGREGATE_PAYMENT_TEMPLATE_CODE}`, loggerCtx);
    }

    /** 固定聚合码收款支付全局模板（门店到店收银，租户可在全局方案池「引用到本店」） */
    private async seedFixedAggregatePaymentTemplate(ctx: RequestContext): Promise<void> {
        const existing = await this.connection
            .getRepository(ctx, PaymentTemplate)
            .findOne({ where: { code: FIXED_AGGREGATE_COLLECTION_TEMPLATE_CODE } });
        if (existing) return;
        await this.paymentTemplateService.create(ctx, {
            name: '固定聚合码收款',
            description: '门店到店收银：顾客扫门店固定聚合收款码付款到商户，店员确认到账后完成订单',
            code: FIXED_AGGREGATE_COLLECTION_TEMPLATE_CODE,
            handler: { code: 'fixed-aggregate-collection', arguments: [] },
            isGlobal: true,
        } as any);
        Logger.info(`已创建默认支付模板: ${FIXED_AGGREGATE_COLLECTION_TEMPLATE_CODE}`, loggerCtx);
    }

    /**
     * 幂等创建前 20 个官方自营租户（tenantNo 1-20，isOfficial=true）。
     * 每个租户：3 个内置角色（租户管理员/销售/库存）+ 默认管理员 admin
     *            + 门店自提配送方式 + 门店收银支付方式（复用全局 handler）。
     * 已存在（按 channel.code 判重）则跳过。
     */
    private async seedOfficialTenants(ctx: RequestContext): Promise<void> {
        const { Channel, Role } = await this.ensureCoreEntities(['Channel', 'Role']);
        const channelRepo = this.connection.getRepository(ctx, Channel);
        const roleRepo = this.connection.getRepository(ctx, Role);

        // tenantNo 在数据库上没有唯一约束：业务租户（如 t1）可能已经占用了 1..20 的号位，
        // 直接写入会静默出现两个渠道同号。故先一次性载入现有渠道做占用检测。
        const existingChannels: any[] = await channelRepo.find({} as any);

        for (let i = 1; i <= 20; i++) {
            const code = `official-${String(i).padStart(2, '0')}`;
            const token = `official-${i}`;
            // 按 code 或 token 任一命中即视为已存在：历史数据中存在 code 被改过
            // （如 official-20 改名 limin）但 token 仍占用的情况，只按 code 判重会撞 token 唯一键
            const exists = await channelRepo.findOne({ where: [{ code }, { token }] } as any);
            if (exists) {
                Logger.info(`官方自营租户 ${code} 已存在，跳过`, loggerCtx);
                continue;
            }

            const occupant = findTenantNoOccupant(existingChannels, i);
            if (occupant) {
                if (occupant.isOfficial) {
                    Logger.warn(
                        `官方位 ${i} 已被官方渠道 ${occupant.code} 占用（tenantNo=${i}），跳过创建 ${code}`,
                        loggerCtx,
                    );
                } else {
                    Logger.error(
                        `tenantNo=${i} 已被非官方渠道占用（code=${occupant.code}），跳过官方位 ${i}`,
                        loggerCtx,
                    );
                }
                continue;
            }

            const channel = await channelRepo.save(
                new Channel({
                    code,
                    token,
                    defaultLanguageCode: LanguageCode.zh_Hans,
                    defaultCurrencyCode: 'CNY' as any,
                    // 必须显式给 availableCurrencyCodes：直接 new Channel 时不会走 ChannelService.create 的默认值推导，
                    // 列为 null 会让 Admin API 的 channels 查询报 "Cannot return null for non-nullable field Channel.availableCurrencyCodes"
                    availableCurrencyCodes: ['CNY'] as any,
                    pricesIncludeTax: true,
                    customFields: {
                        enabled: true,
                        tenantNo: i,
                        isOfficial: true,
                        shopName: `官方自营${String(i).padStart(2, '0')}`,
                    },
                } as any),
            );
            existingChannels.push(channel);
            Logger.info(`已创建官方自营租户 ${code}`, loggerCtx);

            // 3 个内置角色（限定该 channel；权限清单来自单一模板）
            const [tenantAdminRole, salesRole, stockRole] = await Promise.all(
                OFFICIAL_ROLE_TEMPLATES.map((tpl) =>
                    this.createTenantRoleRecord(ctx, roleRepo, channel, `official-${tpl.busiPrefix}-${i}`, tpl.description, tpl.permissions),
                ),
            );

            // 默认管理员 admin（完善 user + 原生认证 + 绑定租户管理员角色，否则账号无法登录）
            await this.createOfficialAdminWithAccount(ctx, channel, tenantAdminRole, i);
            try {
                await this.shippingMethodService.create(ctx, {
                    code: `store-pickup-${code}`,
                    fulfillmentHandler: 'store-pickup',
                    checker: { code: 'store-pickup-eligibility', arguments: [] },
                    calculator: { code: 'store-pickup-calculator', arguments: [] },
                    translations: [{ languageCode: LanguageCode.zh_Hans, name: '门店自提', description: '到指定门店自提商品' }],
                    channels: [channel],
                } as any);
                await this.paymentMethodService.create(ctx, {
                    code: `cashier-${code}`,
                    enabled: true,
                    handler: { code: 'cash-on-delivery', arguments: [] },
                    translations: [{ languageCode: LanguageCode.zh_Hans, name: '门店收银', description: '到店收银台支付' }],
                    channels: [channel],
                } as any);
            } catch (e: any) {
                Logger.warn(`官方租户 ${code} 履约初始化失败: ${e.message}`, loggerCtx);
            }
        }
    }

    /**
     * 官方管理员账号完整建链：NativeAuthenticationMethod(user+auth) → User(绑定角色) → Administrator(挂 user) → TenantMember。
     * 直接 save Administrator 不会生成 vendure 认证链路（user/authentication_method），导致账号无法登录。
     */
    private async createOfficialAdminWithAccount(
        ctx: RequestContext,
        channel: any,
        role: any,
        i: number,
    ): Promise<void> {
        const { Administrator, User, NativeAuthenticationMethod } = await this.ensureCoreEntities([
            'Administrator',
            'User',
            'NativeAuthenticationMethod',
        ]);
        const adminRepo = this.connection.getRepository(ctx, Administrator);
        const userRepo = this.connection.getRepository(ctx, User);
        const authRepo = this.connection.getRepository(ctx, NativeAuthenticationMethod);
        const memberRepo = this.connection.getRepository(ctx, TenantMember);
        const code = `official-${String(i).padStart(2, '0')}`;
        // 约定账号命名统一补零两位（与渠道 code 一致），如 admin-official-01@local.dev
        const email = `admin-official-${String(i).padStart(2, '0')}@local.dev`;
        const auth = await authRepo.save(
            new NativeAuthenticationMethod({
                identifier: email,
                passwordHash: await this.hashPassword('Admin@123456'),
            } as any),
        );
        const user = await userRepo.save(
            new User({
                identifier: email,
                verified: true,
                authenticationMethods: [auth],
                roles: role ? [role] : [],
            } as any),
        );
        const admin = await adminRepo.save(
            new Administrator({
                firstName: '官方自营',
                lastName: code,
                emailAddress: email,
                user,
            } as any),
        );
        await memberRepo.save(
            new TenantMember({
                administratorId: String(admin.id),
                channelId: String(channel.id),
                enabled: true,
                displayName: `官方自营${String(i).padStart(2, '0')}管理员`,
                remark: 'seed 默认管理员',
                shippingProfileIds: [],
            } as any),
        );
    }

    /** 修复历史破损官方管理员：此前直存 Administrator 未建 user/auth，现补齐使其可登录。
     *  幂等：user 已存在则跳过；破损则删旧 Admin + 其 TenantMember，再用正确链路重建。 */
    private async repairOfficialAdminAccounts(ctx: RequestContext): Promise<void> {
        const { Administrator, Channel, Role } = await this.ensureCoreEntities(['Administrator', 'Channel', 'Role']);
        const adminRepo = this.connection.getRepository(ctx, Administrator);
        const channelRepo = this.connection.getRepository(ctx, Channel);
        const roleRepo = this.connection.getRepository(ctx, Role);
        const memberRepo = this.connection.getRepository(ctx, TenantMember);
        let repaired = 0;
        for (let i = 1; i <= 20; i++) {
            const code = `official-${String(i).padStart(2, '0')}`;
            const email = `admin-official-${i}@local.dev`;
            const admin = await adminRepo.findOne({
                where: { emailAddress: email } as any,
                relations: ['user'],
            });
            if (!admin) continue;
            if ((admin as any).user) continue; // 已就绪
            const channel = await channelRepo.findOne({ where: { code } as any });
            if (!channel) {
                Logger.warn(`修复官方管理员: 租户 ${code} 不存在，跳过`, loggerCtx);
                continue;
            }
            const role = await roleRepo.findOne({ where: { code: `official-tenant-admin-${i}` } as any });
            const oldId = String((admin as any).id);
            await memberRepo.delete({ administratorId: oldId } as any);
            await adminRepo.remove(admin);
            await this.createOfficialAdminWithAccount(ctx, channel, role, i);
            repaired++;
        }
        if (repaired) {
            Logger.info(`已修复 ${repaired} 个官方管理员登录账号（补齐 user+authentication_method）`, loggerCtx);
        }
    }

    /** 为已存在的官方内置角色补齐 Authenticated 权限（历史种子直存 Role 遗漏该权限），否则过期账号登录被拒。幂等。 */
    private async ensureOfficialRolesAuthenticated(ctx: RequestContext): Promise<void> {
        const { Role } = await this.ensureCoreEntities(['Role']);
        const roleRepo = this.connection.getRepository(ctx, Role);
        let fixed = 0;
        for (let i = 1; i <= 20; i++) {
            for (const busi of OFFICIAL_ROLE_TEMPLATES.map((t) => t.busiPrefix)) {
                const code = `official-${busi}-${i}`;
                const role = await roleRepo.findOne({ where: { code } as any });
                if (!role) continue;
                const perms: string[] = (role as any).permissions || [];
                if (perms.includes(Permission.Authenticated)) continue;
                (role as any).permissions = Array.from(new Set([Permission.Authenticated, ...perms]));
                await roleRepo.save(role);
                fixed++;
            }
        }
        if (fixed) {
            Logger.info(`已为 ${fixed} 个官方角色补齐 Authenticated 权限`, loggerCtx);
        }
    }

    /**
     * 按角色模板补齐存量角色权限：模板新增权限（如租户网点管理所需的 CreateStockLocation 等）时，
     * 已存在的租户角色自动同步。幂等且只增不减（不删除角色现有权限），避免覆盖租户定制。
     * 匹配范围：official-tenant-admin-N（官方 seed 角色）与 tN-tenant-admin / tN-sales / tN-stock（租户角色）。
     */
    private async syncRolePermissionsFromTemplates(ctx: RequestContext): Promise<void> {
        const { Role } = await this.ensureCoreEntities(['Role']);
        const roleRepo = this.connection.getRepository(ctx, Role);
        const all: any[] = await roleRepo.find({} as any);
        let fixed = 0;
        for (const role of all) {
            const code: string = role.code || '';
            const tpl = OFFICIAL_ROLE_TEMPLATES.find((t) => {
                if (code === t.busiPrefix || code === `official-${t.busiPrefix}`) return true;
                // 官方 seed 角色：official-tenant-admin-N
                if (new RegExp(`^official-${t.busiPrefix}-\\d+$`).test(code)) return true;
                // 租户角色：tN-tenant-admin / tN-sales / tN-stock
                if (new RegExp(`^t\\d+-${t.busiPrefix}$`).test(code)) return true;
                return false;
            });
            if (!tpl) continue;
            const cur: string[] = (role as any).permissions || [];
            const missing = tpl.permissions.filter((p) => !cur.includes(p));
            if (!missing.length) continue;
            (role as any).permissions = Array.from(new Set([...cur, ...tpl.permissions]));
            await roleRepo.save(role);
            fixed++;
        }
        if (fixed) {
            Logger.info(`已为 ${fixed} 个租户角色按模板补齐权限（含 StockLocation 网点管理）`, loggerCtx);
        }
    }

    /** 延迟加载 Vendure 核心实体，避免 seed 阶段循环依赖 */
    private async ensureCoreEntities(names: string[]): Promise<Record<string, any>> {
        const core = await import('@vendure/core');
        const result: Record<string, any> = {};
        for (const name of names) result[name] = (core as any)[name];
        return result;
    }

    private async createTenantRoleRecord(
        ctx: RequestContext,
        roleRepo: any,
        channel: any,
        code: string,
        description: string,
        permissions: string[],
    ): Promise<any> {
        const { Role } = await this.ensureCoreEntities(['Role']);
        // 官方链路必须含 Authenticated，否则管理员登录后任何 @Allow(Authenticated) 查询都会被拒
        const perms = Array.from(new Set([Permission.Authenticated, ...permissions]));
        const role = new Role({ code, description, permissions: perms, channels: [channel] } as any);
        return roleRepo.save(role);
    }

    private async hashPassword(plain: string): Promise<string> {
        const { BcryptPasswordHashingStrategy } = await import('@vendure/core');
        const s = new BcryptPasswordHashingStrategy();
        return s.hash(plain);
    }
}

export const DEFAULT_STORE = {
    name: '自由大路店',
    type: 'store' as const,
    address: '自由大路',
    phoneNumber: '',
    businessHours: '09:00-21:00',
};

export const STORE_PICKUP_METHOD_CODE = 'store-pickup';
export const STORE_PICKUP_TEMPLATE_CODE = 'store-pickup-template';
export const PICKUP_POINT_TEMPLATE_CODE = 'pickup-point-template';
export const EMPLOYEE_PICKUP_TEMPLATE_CODE = 'employee-pickup-template';
export const LOCAL_DELIVERY_TEMPLATE_CODE = 'local-delivery-template';
export const MAIL_TEMPLATE_CODE = 'mail-template';
export const STORE_PICKUP_PROFILE_CODE = 'store-pickup-profile';
export const CASHIER_PAYMENT_METHOD_CODE = 'cash-on-delivery';
export const CASHIER_PAYMENT_PROFILE_CODE = 'store-cashier-profile';
export const COD_PAYMENT_TEMPLATE_CODE = 'cod-payment-template';
export const BALANCE_PAY_TEMPLATE_CODE = 'balance-pay-template';
export const AGGREGATE_PAYMENT_TEMPLATE_CODE = 'aggregate-pay';
export const FIXED_AGGREGATE_COLLECTION_TEMPLATE_CODE = 'fixed-aggregate-collection';