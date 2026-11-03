import { OnApplicationBootstrap } from '@nestjs/common';
import { DocumentNode, parse } from 'graphql';
import {
    ChannelService,
    ConfigService,
    configureDefaultOrderProcess,
    DefaultProductVariantPriceUpdateStrategy,
    EntityHydrator,
    EventBus,
    FacetService,
    LanguageCode,
    OrderStateTransitionEvent,
    Permission,
    PluginCommonModule,
    RefundEvent,
    RequestContext,
    RequestContextService,
    Role,
    RoleService,
    TransactionalConnection,
    User,
    VendurePlugin,
} from '@vendure/core';
import { MARKETPLACE_PLUGIN_OPTIONS, SALE_SOURCE_MARKETPLACE } from './constants';
import { LedgerService } from './ledger.service';
import { MarketplaceInventoryLedger } from './entities/marketplace-inventory-ledger.entity';
import { MarketplacePluginOptions } from './types';
import { marketplaceCustomFields } from './custom-fields';
import { MarketplaceService } from './marketplace.service';
import { MarketplaceSellerService } from './marketplace-seller-service';
import { shopApiExtensions } from './api/api-extensions';
import { ShopResolver } from './api/shop.resolver';
import { multivendorShippingEligibilityChecker } from './config/mv-shipping-eligibility-checker';
import { MarketplaceSellerStrategy } from './marketplace-seller.strategy';
import { MarketplaceStockLocationStrategy } from './marketplace-stock.strategy';
import { marketplaceOrderProcess } from './marketplace-order-process';
import { paymentApiExtensions } from './payment/api-extensions';
import { DirectPaymentResolver } from './payment/direct-payment.resolver';
import { adminApiExtensions } from './api/admin.api-extensions';
import { AdminMarketplaceResolver } from './api/admin.resolver';
import { MerchantApiController } from './api/merchant-api.controller';
import { MerchantApiTokenService } from './merchant-api-token.service';
import { SettlementService } from './settlement.service';

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [MarketplaceInventoryLedger],
    configuration: config => {
        // 幂等追加：本 fork 的 preBootstrapConfig 会多次应用插件 configuration（setConfig + runPluginConfigurations），
        // 若直接用 `[...(config.customFields.X || []), ...marketplaceCustomFields.X]` 会导致重复自定义字段，
        // 触发 core 的 validateCustomFieldsConfig 硬校验（duplicated custom field name）。改为按 name 去重。
        const mergeFields = (target: any[], source: any[]) => {
            const existing = new Set(target.map(f => f.name));
            for (const f of source) {
                if (!existing.has(f.name)) {
                    target.push(f);
                    existing.add(f.name);
                }
            }
        };
        mergeFields(config.customFields.Product, marketplaceCustomFields.Product!);
        mergeFields(config.customFields.Order, marketplaceCustomFields.Order!);
        mergeFields(config.customFields.Channel, marketplaceCustomFields.Channel!);
        mergeFields(config.customFields.Seller, marketplaceCustomFields.Seller!);
        config.shippingOptions.shippingEligibilityCheckers.push(multivendorShippingEligibilityChecker);

        // 修复：按 __isDefaultOrderProcess 标记替换默认进程（mergeConfig 深拷贝后身份比对失效），
        // 保留其他插件注册的自定义进程（如 campus-delivery 起送价校验）；
        // 过滤本插件已注册进程保证 configuration 被多次应用时幂等。
        const existingProcesses = (config.orderOptions.process ?? []).filter(
            p => !(p as any).__isDefaultOrderProcess && p !== marketplaceOrderProcess,
        );
        config.orderOptions.process = [
            configureDefaultOrderProcess({ checkFulfillmentStates: false }),
            ...existingProcesses,
            marketplaceOrderProcess,
        ];
        config.orderOptions.orderSellerStrategy = new MarketplaceSellerStrategy();
        config.catalogOptions.productVariantPriceUpdateStrategy =
            new DefaultProductVariantPriceUpdateStrategy({ syncPricesAcrossChannels: true });
        config.catalogOptions.stockLocationStrategy = new MarketplaceStockLocationStrategy();
        return config;
    },
    shopApiExtensions: {
        schema: (): DocumentNode => parse(`${shopApiExtensions}\n${paymentApiExtensions}`),
        resolvers: [ShopResolver, DirectPaymentResolver],
    },
    adminApiExtensions: {
        schema: (): DocumentNode => parse(`${adminApiExtensions}`),
        resolvers: [AdminMarketplaceResolver],
    },
    providers: [
        MarketplaceService,
        MarketplaceSellerService,
        SettlementService,
        LedgerService,
        MerchantApiTokenService,
        { provide: MARKETPLACE_PLUGIN_OPTIONS, useFactory: () => MarketplacePlugin.options },
    ],
    controllers: [MerchantApiController],
})
export class MarketplacePlugin implements OnApplicationBootstrap {
    static options: MarketplacePluginOptions;

    constructor(
        private eventBus: EventBus,
        private connection: TransactionalConnection,
        private entityHydrator: EntityHydrator,
        private ledgerService: LedgerService,
        private roleService: RoleService,
        private channelService: ChannelService,
        private configService: ConfigService,
        private requestContextService: RequestContextService,
        private facetService: FacetService,
    ) {}

    static init(options: MarketplacePluginOptions) {
        MarketplacePlugin.options = options;
        return MarketplacePlugin;
    }

    async onApplicationBootstrap(): Promise<void> {
        await this.ensureBrandFacet();
        await this.ensurePlatformOpsRole();

        this.eventBus.ofType(OrderStateTransitionEvent).subscribe(async event => {
            const { order, ctx } = event;
            // 仅记录 marketplace 商家子单的销售
            if (order.customFields?.saleSource !== SALE_SOURCE_MARKETPLACE) {
                return;
            }
            const states = new Set(['Shipped', 'Fulfilled', 'Delivered', 'Completed']);
            if (!event.toState || !states.has(event.toState)) {
                return;
            }
            await this.entityHydrator.hydrate(ctx, order, {
                relations: ['lines', 'lines.productVariant', 'lines.productVariant.stockLevels', 'lines.sellerChannel'],
            });
            for (const line of order.lines) {
                const merchantChannelId = line.sellerChannelId
                    ? String(line.sellerChannelId)
                    : String(ctx.channelId);
                const stockOnHand = line.productVariant.stockLevels
                    ? line.productVariant.stockLevels.reduce<number>((sum, l) => sum + l.stockOnHand, 0)
                    : 0;
                await this.ledgerService.recordChange(ctx, {
                    variantId: line.productVariantId,
                    merchantChannelId,
                    saleSource: SALE_SOURCE_MARKETPLACE,
                    stockBefore: stockOnHand,
                    stockAfter: stockOnHand - line.quantity,
                    stockDelta: -line.quantity,
                    actionType: 'sale',
                    orderId: String(order.id),
                });
            }
        });

        // marketplace 商家子单退款时回补库存（actionType='refund'，stockDelta 为正）
        this.eventBus.ofType(RefundEvent).subscribe(async event => {
            const { order, refund, ctx } = event;
            // 仅处理 marketplace 商家子单的退款
            if (order.customFields?.saleSource !== SALE_SOURCE_MARKETPLACE) {
                return;
            }
            await this.entityHydrator.hydrate(ctx, refund, {
                relations: [
                    'lines',
                    'lines.orderLine',
                    'lines.orderLine.productVariant',
                    'lines.orderLine.productVariant.stockLevels',
                    'lines.orderLine.sellerChannel',
                ],
            });
            for (const line of refund.lines ?? []) {
                const orderLine = line.orderLine;
                if (!orderLine) {
                    continue;
                }
                const merchantChannelId = orderLine.sellerChannelId
                    ? String(orderLine.sellerChannelId)
                    : String(ctx.channelId);
                const stockOnHand = orderLine.productVariant?.stockLevels
                    ? orderLine.productVariant.stockLevels.reduce<number>((sum, l) => sum + l.stockOnHand, 0)
                    : 0;
                await this.ledgerService.recordChange(ctx, {
                    variantId: orderLine.productVariantId,
                    merchantChannelId,
                    saleSource: SALE_SOURCE_MARKETPLACE,
                    stockBefore: stockOnHand,
                    stockAfter: stockOnHand + line.quantity,
                    stockDelta: line.quantity,
                    actionType: 'refund',
                    orderId: String(order.id),
                });
            }
        });
    }

    /**
     * 幂等初始化「品牌库」Facet（code = brand）。若已存在则跳过，否则创建并翻译为 zh_Hans「品牌」。
     * 整个方法用 try/catch 包裹：失败仅告警，绝不抛错阻塞启动。
     */
    private async ensureBrandFacet(): Promise<void> {
        try {
            const ctx = await this.getSuperAdminContext();
            const existing = await this.facetService.findByCode(ctx, 'brand', LanguageCode.zh_Hans);
            if (existing) {
                return;
            }
            await this.facetService.create(ctx, {
                code: 'brand',
                isPrivate: false,
                translations: [{ languageCode: LanguageCode.zh_Hans, name: '品牌' }],
                values: [],
            });
            console.warn('[MarketplacePlugin] 品牌库 Facet(brand) 已创建');
        } catch (e) {
            console.error(
                `[MarketplacePlugin] 初始化品牌库 Facet(brand) 失败（已忽略，不阻塞启动）: ${
                    e instanceof Error ? e.message : String(e)
                }`,
            );
        }
    }

    /**
     * 幂等创建「平台运营」角色（code = platform-ops），用于接入 marketplace 审批等平台运营能力。
     */
    private async ensurePlatformOpsRole(): Promise<void> {
        const ctx = await this.getSuperAdminContext();
        const roleCode = MarketplacePlugin.options.platformOpsRoleCode ?? 'platform-ops';
        const existing = await this.connection.getRepository(ctx, Role).findOne({
            where: { code: roleCode },
        });
        if (existing) {
            return;
        }
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        await this.roleService.create(ctx, {
            code: roleCode,
            description: '平台运营',
            channelIds: [defaultChannel.id],
            permissions: [
                Permission.ReadCatalog,
                Permission.UpdateCatalog,
                Permission.ReadProduct,
                Permission.UpdateProduct,
                Permission.ReadOrder,
                Permission.UpdateOrder,
                Permission.ReadCustomer,
            ],
        });
    }

    private async getSuperAdminContext(): Promise<RequestContext> {
        const { superadminCredentials } = this.configService.authOptions;
        const superAdminUser = await this.connection.getRepository(RequestContext.empty(), User).findOne({
            where: {
                identifier: superadminCredentials.identifier,
            },
        });
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return this.requestContextService.create({
            apiType: 'shop',
            user: superAdminUser!,
        });
    }
}