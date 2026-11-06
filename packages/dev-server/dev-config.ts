/* eslint-disable no-console */
import { OnApplicationBootstrap } from '@nestjs/common';
import { AdminUiPlugin } from '@vendure/admin-ui-plugin';
import { AssetServerPlugin } from '@vendure/asset-server-plugin';
import { ADMIN_API_PATH, API_PORT, SHOP_API_PATH } from '@vendure/common/lib/shared-constants';
import {
    cleanOrphanedSettingsStoreTask,
    cleanSessionsTask,
    DefaultJobQueuePlugin,
    DefaultLogger,
    DefaultOrderByCodeAccessStrategy,
    DefaultOrderSellerStrategy,
    DefaultSchedulerPlugin,
    DefaultSearchPlugin,
    configureDefaultOrderProcess,
    dummyPaymentHandler,
    LanguageCode,
    LogLevel,
    PermissionDefinition,
    PluginCommonModule,
    RequestContextService,
    SettingsStoreScopes,
    SettingsStoreService,
    VendureConfig,
    VendurePlugin,
} from '@vendure/core';
import { DashboardPlugin } from '@vendure/dashboard/plugin';
import { defaultEmailHandlers, EmailPlugin, FileBasedTemplateLoader } from '@vendure/email-plugin';
import { GraphiqlPlugin } from '@vendure/graphiql-plugin';
import { HardenPlugin } from '@vendure/harden-plugin';
import { TelemetryPlugin } from '@vendure/telemetry-plugin';
import 'dotenv/config';
import path from 'path';
import { DataSourceOptions } from 'typeorm';
import { Request, Response, NextFunction } from 'express';
import { CjkPlugin, PhysicalAwareStockLocationStrategy } from '@vendure/cjk-plugin';
import { createDepthLimitRule } from './graphql-depth-limit';
import { loginRateLimit } from './login-rate-limit';
// 注意：ReviewsPlugin/FloorBuilderPlugin/NavModifierPlugin 为开发演示插件，
// 改为惰性 require（见 devOnlyPlugins），避免生产模式静态 require 缺失的 test-plugins 产物。
import { AlipayPlugin } from '@vendure/alipay-plugin';
import { WechatpayPlugin } from '@vendure/wechatpay-plugin';
import { OssPlugin } from '@vendure/oss-plugin';
import { PhoneAuthPlugin } from '@vendure/phone-auth-plugin';
import { WechatAuthPlugin } from '@vendure/wechat-auth-plugin';
import { DouyinAuthPlugin } from '@vendure/douyin-auth-plugin';
import { OrderTimeoutPlugin } from '@vendure/order-timeout-plugin';
import { InvoicePlugin } from '@vendure/invoice-plugin';
import { LogisticsPlugin } from '@vendure/logistics-plugin';
import { DeliveryGatewayPlugin } from '@vendure/delivery-gateway-plugin';
import { GroupBuyPlugin } from '@vendure/group-buy-plugin';
import { FlashSalePlugin } from '@vendure/flash-sale-plugin';
import { DistributionPlugin } from '@vendure/distribution-plugin';
import { EcoPlugin } from '@vendure/eco-plugin';
import { ProductSurveyPlugin } from '@vendure/product-survey-plugin';
import { RedisStockPlugin } from '@vendure/redis-stock-plugin';
import { LogisticsApiPlugin } from '@vendure/logistics-api-plugin';
import { InvoicePdfPlugin, PdfInvoiceProvider } from '@vendure/invoice-pdf-plugin';
import { RechargeCardPlugin } from '@vendure/recharge-card-plugin';
import { AfterSalesPlugin } from '@vendure/after-sales-plugin';
import { MemberLevelPlugin } from '@vendure/member-level-plugin';
import { VcashPosPlugin } from '@vendure/vcash-pos-plugin';
import { VcashOfflinePlugin } from '@vendure/vcash-offline-plugin';
import { CheckinPlugin } from '@vendure/checkin-plugin';
import { FeedbackPlugin } from '@vendure/feedback-plugin';
import { LotteryPlugin } from '@vendure/lottery-plugin';
import { ShoppingCirclePlugin } from '@vendure/shopping-circle-plugin';
import { PointsMallPlugin } from '@vendure/points-mall-plugin';
import { ReviewPlugin } from '@vendure/review-plugin';
import { WechatSubscribeMessagePlugin } from '@vendure/wechat-subscribe-message-plugin';
import { CouponPlugin } from '@vendure/coupon-plugin';
import { VoucherPlugin } from '@vendure/voucher-plugin';
import { SubscriptionPlugin } from '@vendure/subscription-plugin';
import { MerchantPlugin } from '@vendure/merchant-plugin';
import { BillPayPlugin } from '@vendure/bill-pay-plugin';
import { CampusDeliveryPlugin } from '@vendure/campus-delivery-plugin';
import { CampusJianghuPlugin } from '@vendure/campus-jianghu-plugin';
import { DeliveryPlugin } from '@vendure/delivery-plugin';
import { SalesPlugin } from '@vendure/sales-plugin';
import { SalesOrderItemPriceCalculationStrategy } from '@vendure/sales-plugin';
import { MarketplacePlugin } from '@vendure/marketplace-plugin';
import { CustomerServicePlugin } from '@vendure/customer-service-plugin';
import { InventoryPlugin } from '@vendure/inventory-plugin';
import { MessagePlugin } from '@vendure/message-plugin';
import { NotificationPlugin } from '@vendure/notification-plugin';
import { OperationsPlugin } from '@vendure/operations-plugin';
import { PreSalePlugin } from '@vendure/pre-sale-plugin';
import { PaymentSchedulePlugin } from '@vendure/payment-schedule-plugin';
import { InstallmentPlugin } from '@vendure/installment-plugin';
import { RentalPlugin } from '@vendure/rental-plugin';
import { LiveStreamingPlugin } from '@vendure/live-streaming-plugin';
import { ShopPlugin } from '@vendure/shop-plugin';
import { PickupPlugin } from '@vendure/pickup-plugin';
import { ShopTemplatePlugin } from '@vendure/shop-template-plugin';
import { DiyPlugin } from '@vendure/diy-plugin';
import { FavoritePlugin } from '@vendure/favorite-plugin';
import { TcmClinicPlugin } from '@vendure/tcm-clinic-plugin';
import { MeiliSearchPlugin } from '@vendure/meilisearch-plugin';
import { WechatShoppingAssistantPlugin } from '@vendure/wechat-shopping-assistant-plugin';

// 本地联调默认注入 REDEMPTION_KEY（AES-GCM/HMAC 密钥，64 hex chars）
if (!process.env.REDEMPTION_KEY) {
    process.env.REDEMPTION_KEY = 'd'.repeat(64); // dev only：生产由运维注入
}

// 生产模式（dist/）跳过开发演示插件，避免静态 import require 缺失的 test-plugins 产物
// IS_PROD=true 环境变量：dashboard vite 构建时 config-loader 编译到临时目录，
// __dirname 非 dist，需用环境变量显式标记生产，跳过 test-plugins
const IS_PROD = path.basename(__dirname) === 'dist' || process.env.IS_PROD === 'true';
const devOnlyPlugins = IS_PROD
    ? []
    : (() => {
          const { ReviewsPlugin } = require('./test-plugins/reviews/reviews-plugin');
          const { FloorBuilderPlugin } = require('./test-plugins/floor-builder');
          const { NavModifierPlugin } = require('./test-plugins/nav-modifier-plugin/nav-modifier-plugin');
          return [ReviewsPlugin, FloorBuilderPlugin, NavModifierPlugin];
      })();

// 统一解析 dev-server 目录：dev 模式 __dirname=packages/dev-server，prod 模式 __dirname=packages/dev-server/dist
const devServerDir = path.basename(__dirname) === 'dist' ? path.dirname(__dirname) : __dirname;

const IS_INSTRUMENTED = process.env.IS_INSTRUMENTED === 'true';

/**
 * 生产硬门禁：devBypass 类开关（微信/支付宝/抖音支付、短信、微信登录、SSO mock）
 * 一律以进程模式为准，不能只靠 `.env` 里的 DEV_BYPASS_* 值。
 * 即使 .env 误留 `DEV_BYPASS_X=true`，生产（dist/ 或 NODE_ENV=production）也强制关闭。
 */
const IS_NODE_PROD = process.env.NODE_ENV === 'production';
const ALLOW_DEV_BYPASS = !IS_PROD && !IS_NODE_PROD;
const devBypassEnabled = (envName: string): boolean =>
    ALLOW_DEV_BYPASS && process.env[envName] === 'true';

@VendurePlugin({
    imports: [PluginCommonModule],
    configuration: config => {
        config.settingsStoreFields = {
            ...config.settingsStoreFields,
            ReadonlyTest: [
                { name: 'buildVersion', readonly: true },
                { name: 'buildMeta', readonly: true },
            ],
        };
        return config;
    },
})
class ReadonlySettingsTestPlugin implements OnApplicationBootstrap {
    constructor(
        private settingsStoreService: SettingsStoreService,
        private requestContextService: RequestContextService,
    ) {}
    async onApplicationBootstrap() {
        const ctx = await this.requestContextService.create({ apiType: 'admin' });
        await this.settingsStoreService.set(ctx, 'ReadonlyTest.buildVersion', 'v3.5.2' as any);
        await this.settingsStoreService.set(ctx, 'ReadonlyTest.buildMeta', {
            buildDate: '2026-03-06',
            commit: 'd0384f3ed',
            features: ['settings-store-ui', 'option-groups'],
        });
    }
}

/**
 * 源头修复（2026-09-04）：本项目为多租户（cjk 租户渠道），非 Vendure marketplace 多商户。
 * MarketplacePlugin 会把挂租户渠道的商品通过 MarketplaceSellerStrategy 拆出 Seller「配送子单」
 * （aggregateOrderId 幽灵子单，类型 delivery、state ArrangingPayment、数量与聚合单一致），
 * 造成客户侧"一单变两单"与数量/金额翻倍。
 * 本插件强制把 orderSellerStrategy 恢复为 DefaultOrderSellerStrategy（不拆分、不再赋 sellerChannel），
 * 从根本上不再生成 Seller 子单。必须置于 plugins 数组最末，使本 configuration 钩子覆盖 MarketplacePlugin 的赋值。
 */
@VendurePlugin({
    configuration: config => {
        config.orderOptions.orderSellerStrategy = new DefaultOrderSellerStrategy();
        return config;
    },
})
class DisableSellerSplitPlugin {}

/**
 * 放宽进入 ArrangingPayment 的「顾客/配送方式必填」两道默认守卫（2026-10-14）：
 * 公众号购物助手、POS 等无头下单无物流环节（服务类商品如洗车），支付由 H5 收银台直付
 * （vshop payment.vue 的 PAYABLE_STATES 含 AddingItems，页面自行 transition）。
 * 按默认进程标记替换（保留 checkFulfillmentStates:false 的 logistics 放宽），保留
 * campus 起送价 / marketplace 等自定义进程；有货校验、内容校验等其余默认守卫不动。
 * 必须置于 Marketplace/Logistics 之后、DisableSellerSplitPlugin 之前。
 */
@VendurePlugin({
    configuration: config => {
        const existing = (config.orderOptions.process ?? []).filter(
            p => !(p as any).__isDefaultOrderProcess,
        );
        config.orderOptions.process = [
            configureDefaultOrderProcess({
                checkFulfillmentStates: false,
                arrangingPaymentRequiresCustomer: false,
                arrangingPaymentRequiresShipping: false,
            }),
            ...existing,
        ];
        return config;
    },
})
class RelaxArrangingPaymentGuardPlugin {}

/**
 * Config settings used during development
 */
export const devConfig: VendureConfig = {
    apiOptions: {
        port: Number(process.env.API_PORT) || API_PORT,
        adminApiPath: ADMIN_API_PATH,
        // 生产关闭 Playground 与调试信息（避免暴露 schema/内部错误栈）
        adminApiPlayground: IS_PROD
            ? false
            : {
                  settings: {
                      'request.credentials': 'include',
                  },
              },
        adminApiDebug: !IS_PROD,
        shopApiPath: SHOP_API_PATH,
        shopApiPlayground: IS_PROD
            ? false
            : {
                  settings: {
                      'request.credentials': 'include',
                  },
              },
        shopApiDebug: !IS_PROD,
        // 位于 nginx 之后，信任第一层代理以获取真实客户端 IP（登录限速按 IP+账号）
        trustProxy: 1,
        // GraphQL 查询深度上限（防深嵌套拖垮服务；复杂度上限由 HardenPlugin 负责）
        adminApiValidationRules: [createDepthLimitRule(12)],
        shopApiValidationRules: [createDepthLimitRule(12)],
        middleware: [
            {
                handler: (req: Request, res: Response, next: NextFunction) => {
                    if (req.path.startsWith('/assets') || req.url.startsWith('/assets')) {
                        res.setHeader('Access-Control-Allow-Origin', '*');
                    }
                    next();
                },
                route: '/assets',
            },
            {
                // 修复：GET 访问 /admin-api 且不含 GraphQL query 参数时，Apollo 默认返回 400，
                // 导致访问 e.joho.cn 时浏览器控制台出现 "400 (Bad Request)"。
                // 例如 Dashboard 的 admin-api 客户端会拼接 ?languageCode=zh_Hans 发起 GET。
                // 这里对无 query 的 GET 返回 200 的 GraphQL 错误信封，避免 400 刷屏。
                handler: (req: Request, res: Response, next: NextFunction) => {
                    if (req.method === 'GET' && !req.query.query) {
                        res.status(200).json({
                            data: null,
                            errors: [
                                {
                                    message:
                                        'GET requests to the GraphQL Admin API require a "query" parameter. Use POST or include ?query=.',
                                    extensions: { code: 'BAD_REQUEST' },
                                },
                            ],
                        });
                        return;
                    }
                    next();
                },
                route: '/admin-api',
            },
            // 登录/认证失败限速（IP + 账号，5 次失败/15 分钟，进程内计数）
            {
                handler: loginRateLimit,
                route: '/shop-api',
            },
            {
                handler: loginRateLimit,
                route: '/admin-api',
            },
        ],
    },
    authOptions: {
        disableAuth: false,
        tokenMethod: ['bearer', 'cookie', 'api-key'] as const,
        requireVerification: false,
        // 租户配置（支付/地图/登录方式等）专用写权限，按渠道授权，替代原先「渠道成员即可写」的判定
        // 营销活动写权限同理：只授予本渠道内的秒杀/拼团/预售管理，不放开全站 Promotion 权限
        customPermissions: [
            new PermissionDefinition({
                name: 'TenantSettingsManage',
                description: '管理本渠道租户配置（支付/地图/登录方式等）',
            }),
            new PermissionDefinition({
                name: 'TenantPromotionManage',
                description: '管理本渠道营销活动（秒杀/拼团/预售）',
            }),
        ],
        cookieOptions: {
            // 会话 Cookie 签名密钥从环境变量注入，避免源码内置固定 secret 导致会话伪造
            secret: process.env.COOKIE_SECRET || 'abc',
        },
    },
    dbConnectionOptions: {
        synchronize: false,
        // SQL_LOG=1 时直落 simple-console（ConnectionModule 会把 logging 包进 TypeOrmLogger，
        // 其 query 输出走 Logger.debug 被生产 logLevel 滤掉，故需显式 logger 绕过）
        logging: process.env.SQL_LOG === '1' ? ['query', 'error'] : false,
        logger: process.env.SQL_LOG === '1' ? ('simple-console' as any) : undefined,
        migrations: [path.join(devServerDir, 'migrations/*.ts')],
        ...getDbConfig(),
    },
    paymentOptions: {
        paymentMethodHandlers: [dummyPaymentHandler],
    },
    orderOptions: {
        orderItemPriceCalculationStrategy: new SalesOrderItemPriceCalculationStrategy(),
        orderByCodeAccessStrategy: new DefaultOrderByCodeAccessStrategy('7d'),
    },
    settingsStoreFields: {
        MyPlugin: [
            {
                name: 'globalVal',
            },
            {
                name: 'userVal',
                scope: SettingsStoreScopes.user,
            },
        ],
    },
    customFields: {
        Collection: [
            { name: 'floorEnabled', type: 'boolean', defaultValue: false, public: true,
              ui: { component: 'boolean-form-input' } },
            { name: 'floorTitle', type: 'string', public: true,
              ui: { component: 'text-form-input' } },
            { name: 'floorSubtitle', type: 'string', public: true,
              ui: { component: 'text-form-input' } },
            { name: 'floorLayout', type: 'string', defaultValue: 'double_grid', public: true,
              ui: {
                  component: 'select-form-input',
                  options: [
                      { value: 'single_scroll', label: '单列横滑' },
                      { value: 'double_grid', label: '双列网格' },
                      { value: 'triple_grid', label: '三列网格' },
                      { value: 'hero_with_list', label: '大图+列表' },
                  ],
              } },
            { name: 'floorSortOrder', type: 'int', defaultValue: 0, public: true },
            { name: 'floorMaxScreens', type: 'int', defaultValue: 3, public: true },
            {
                name: 'floorTheme', type: 'struct', public: true, fields: [
                    { name: 'primaryColor', type: 'string' },
                    { name: 'backgroundColor', type: 'string' },
                    { name: 'titleIcon', type: 'string' },
                ],
            },
            {
                name: 'floorItemConfig', type: 'struct', list: true, public: true, fields: [
                    { name: 'productId', type: 'string' },
                    { name: 'size', type: 'string',
                      ui: { component: 'select-form-input',
                            options: [
                                { value: 'small', label: '小' },
                                { value: 'medium', label: '中' },
                                { value: 'large', label: '大' },
                            ] } },
                    { name: 'highlighted', type: 'boolean' },
                    { name: 'label', type: 'string' },
                ],
            },
            {
                name: 'floorSchedule', type: 'struct', public: true, fields: [
                    { name: 'startAt', type: 'datetime' },
                    { name: 'endAt', type: 'datetime' },
                ],
            },
        ],
        Channel: [
            // 店铺装修字段（对齐生产 + 装修需要，Task 6）
            { name: 'displayTemplate', type: 'string', defaultValue: 'standard', public: true },
            { name: 'themeId', type: 'string', defaultValue: 'taobao-orange', public: true },
            // 余额提现起提金额（分，int nullable）：null/<=0 回退后端默认 1000（¥10）
            // 注意：分销插件已占用 Channel.minWithdrawalAmount（分销佣金提现，默认 10000），此处须用独立名
            { name: 'balanceMinWithdrawalAmount', type: 'int', nullable: true, public: true,
              label: [{ languageCode: LanguageCode.zh_Hans, value: '余额提现起提金额(分)' }] },
            // 抽奖每次固定消耗（积分，int nullable）：null = 按所中奖品 consume（现状）；>=0 = 每次固定扣该值
            { name: 'lotteryFixedCost', type: 'int', nullable: true, public: true,
              label: [{ languageCode: LanguageCode.zh_Hans, value: '抽奖每次固定消耗(积分)' }] },
            { name: 'shopName', type: 'string', public: true },
            { name: 'shopLogo', type: 'string', public: true },
            { name: 'shopIntro', type: 'string', public: true },
            { name: 'servicePhone', type: 'string', public: true },
            // shopContent 存装修 JSON 字符串（Vendure 3.6.4 无 type:'json'，用 text 承载序列化 JSON）
            { name: 'shopContent', type: 'text', public: true },
            // detailConfig 存商品详情页装修 JSON 字符串（结构化 schema 见 nshop layers/base/app/utils/detail-config.ts）
            { name: 'detailConfig', type: 'text', public: true },
            // orderDetailConfig 存订单详情页装修 JSON（结构化 schema 见 nshop layers/base/app/utils/order-config.ts）
            { name: 'orderDetailConfig', type: 'text', public: true },
            // orderListConfig 存订单列表版式 JSON（本期仅 card）
            { name: 'orderListConfig', type: 'text', public: true },
            // promoSchemes/serviceSchemes 存频道促销/服务方案库 JSON（[{code,text:{zh_Hans,en}}]，勾选启用即入列）
            { name: 'promoSchemes', type: 'text', public: true },
            { name: 'serviceSchemes', type: 'text', public: true },
            // 分类/购物车/我的 页面装修 JSON（web-admin 装修表单写入，C 端按页合并）
            { name: 'pageCategoryConfig', type: 'text', public: true },
            { name: 'pageCartConfig', type: 'text', public: true },
            { name: 'pageProfileConfig', type: 'text', public: true },
        ],
        Customer: [],
        Fulfillment: [],
        Order: [],
        Product: [],
        Promotion: [],
    },
    schedulerOptions: {
        // 生产为单进程部署（pm2 只跑 prod-start.js → dist/index，常驻 worker 进程为零），
        // 若限制「任务只在 worker 执行」，所有 ScheduledTask 在生产永远不会运行——
        // 2026-10-25 实证：待付款补偿扫描缺失致订单卡 ArrangingPayment 11 天，
        // OrderTimeoutPlugin 补偿、会话清理、售后超时、秒杀/拼团状态切换同样全停。
        // 单进程部署的官方推荐做法是在当前进程执行计划任务；本地 `npm run dev` 会
        // server+worker 双进程各跑一次（幂等补偿无害，介意可本地临时改回 true）。
        runTasksInWorkerOnly: false,
        tasks: [cleanSessionsTask, cleanOrphanedSettingsStoreTask],
    },
    // 生产日志降到 Info（Verbose 会打印 GraphQL 查询/内部细节，且放大量级）
    logger: new DefaultLogger({ level: IS_PROD ? LogLevel.Info : LogLevel.Verbose }),
    importExportOptions: {
        importAssetsDir: path.join(devServerDir, 'import-assets'),
    },
    plugins: [
        // MultivendorPlugin.init({
        //     platformFeePercent: 10,
        //     platformFeeSKU: 'FEE',
        // }),
        ReadonlySettingsTestPlugin,
        // FieldTestPlugin,
        // 生产：复杂度上限 + 关闭 introspection/debug；GraphiQL 调试台仅非生产启用
        // 上限 9500：临时放宽——分类/首页真实查询复杂度峰值 8788，3000 会误杀；
        // 前端整包重建后按实测峰值回调。
        ...(IS_PROD ? [HardenPlugin.init({ maxQueryComplexity: 9500, apiMode: 'prod' })] : []),
        ...devOnlyPlugins,
        ...(IS_PROD ? [] : [GraphiqlPlugin.init()]),
        AssetServerPlugin.init({
            route: 'assets',
            assetUploadDir: path.join(devServerDir, 'assets'),
        }),
        DefaultSearchPlugin.init({ bufferUpdates: false, indexStockStatus: false }),
        // Enable if you need to debug the job queue
        // BullMQJobQueuePlugin.init({}),
        DefaultJobQueuePlugin.init({}),
        // JobQueueTestPlugin.init({ queueCount: 10 }),
        DefaultSchedulerPlugin.init({}),
        EmailPlugin.init({
            devMode: true,
            route: 'mailbox',
            handlers: defaultEmailHandlers,
            templateLoader: new FileBasedTemplateLoader(
                path.join(devServerDir, '../email-plugin/templates'),
            ),
            outputPath: path.join(devServerDir, 'test-emails'),
            globalTemplateVars: {
                verifyEmailAddressUrl: 'http://localhost:4201/verify',
                passwordResetUrl: 'http://localhost:4201/reset-password',
                changeEmailAddressUrl: 'http://localhost:4201/change-email-address',
            },
        }),
        ...(IS_INSTRUMENTED ? [TelemetryPlugin.init({})] : []),
        // AdminUiPlugin requires pre-built admin-ui bundle. Build with:
        // cd packages/admin-ui && npm run build:app
        AdminUiPlugin.init({
            route: 'admin',
            port: 5001,
            adminUiConfig: {},
        }),
        DashboardPlugin.init({
            route: 'dashboard',
            appDir: path.join(devServerDir, './dist'),
        }),
        CjkPlugin.init({
            i18n: { enabled: true },
            regions: { enabled: true },
            tenant: { enabled: true, defaultPublicDomain: process.env.DEFAULT_PUBLIC_DOMAIN || 'www.youshop.cn' },
            cod: { enabled: true },
            storePickup: { enabled: true },
            pickupPoint: { enabled: true },
            employeePickup: { enabled: true },
            promotionPolicy: { enabled: true },
            authSecret: process.env.AUTH_SECRET || 'dev-auth-secret-key',
        }),
        ShopPlugin.init({}),
        // 风格模板库与全局配置（四层风格体系后台配置）。app 决定本实例模板库端：nshop/vshop，缺省 nshop
        ShopTemplatePlugin.init({ app: (process.env.APP as 'nshop' | 'vshop') ?? 'nshop' }),
        // DIY 商品：两层素材库 + 玩法模板 + 方案三链路（demo/quote/order）
        // 保持位于设置 orderItemPriceCalculationStrategy 的插件/配置之后（diy 价格包装器委托 original）
        DiyPlugin.init({ app: (process.env.APP as 'nshop' | 'vshop') ?? 'nshop' }),
        PickupPlugin.init({}),
        ...((process.env.ALIPAY_NOTIFY_URL || devBypassEnabled('DEV_BYPASS_ALIPAY')) ? [AlipayPlugin.init({
            notifyUrl: process.env.ALIPAY_NOTIFY_URL || '',
            alipayPublicKey: process.env.ALIPAY_PUBLIC_KEY ?? '',
            sellerId: process.env.ALIPAY_SELLER_ID || undefined,
            auth: devBypassEnabled('DEV_BYPASS_ALIPAY') ? {
                devBypass: true,
                devBypassOpenid: 'dev_test_openid',
            } : undefined,
        })] : []),
        // 微信支付按租户配置（渠道 payConfig.wechatpay：商户凭证 + 回调地址），故插件无条件加载。
        // 历史实现按 WECHATPAY_NOTIFY_URL 条件加载，导致生产未配该 env 时整个插件缺失：
        // CS-/RC- 结算器注册失败、微信支付入口全部不可用。env 仅保留 devBypass 与 notifyUrl 兜底。
        WechatpayPlugin.init({
            notifyUrl: process.env.WECHATPAY_NOTIFY_URL || '',
            devBypass: devBypassEnabled('DEV_BYPASS_WECHATPAY'),
            devBypassOpenid: 'dev_test_openid',
            // 分端分支付方案：额外注册的支付方法 code（handler 同 wechatpay）
            extraHandlerCodes: (process.env.WECHATPAY_EXTRA_HANDLER_CODES || '')
                .split(',').map(s => s.trim()).filter(Boolean),
            // 回调验签凭证路由：回调 Host → PaymentMethod code（JSON）
            // 例：{"www.yourbao.cn":"wechatpay","www.youshop.cn":"wechatpay-youshop-jsapi"}
            callbackMethodMap: process.env.WECHATPAY_CALLBACK_METHOD_MAP
                ? JSON.parse(process.env.WECHATPAY_CALLBACK_METHOD_MAP)
                : undefined,
        }),
        ...(process.env.OSS_ACCESS_KEY_ID ? [OssPlugin.init({
            region: process.env.OSS_REGION ?? '',
            accessKeyId: process.env.OSS_ACCESS_KEY_ID ?? '',
            accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET ?? '',
            bucket: process.env.OSS_BUCKET ?? '',
        })] : []),
        // PhoneAuthPlugin 无条件注册：保证发码/手机注册/重置密码 schema 与手机登录策略始终存在；
        // 未配置 SMS 凭据时发码仅落库不真实发送（SmsService 内建兜底，不会崩溃）
        PhoneAuthPlugin.init({
            accessKeyId: process.env.SMS_ACCESS_KEY_ID || '',
            accessKeySecret: process.env.SMS_ACCESS_KEY_SECRET ?? '',
            signName: process.env.SMS_SIGN_NAME ?? '',
            templateCode: process.env.SMS_TEMPLATE_CODE ?? '',
            devBypass: devBypassEnabled('DEV_BYPASS_SMS'),
            devBypassCode: '123456',
            // 可选：配置后验证码/限流状态存 Redis（多实例部署共享），未配置走进程内存
            redisUrl: process.env.PHONE_AUTH_REDIS_URL || undefined,
        }),
        ...((process.env.WECHAT_AUTH_APP_ID || devBypassEnabled('DEV_BYPASS_WECHAT')) ? [WechatAuthPlugin.init({
            appId: process.env.WECHAT_AUTH_APP_ID || 'dev_test_app_id',
            appSecret: process.env.WECHAT_AUTH_APP_SECRET || 'dev_test_app_secret',
            miniProgramAppId: process.env.WECHAT_AUTH_MINI_APP_ID || '',
            miniProgramAppSecret: process.env.WECHAT_AUTH_MINI_APP_SECRET || '',
            token: process.env.WECHAT_MESSAGE_TOKEN || '',
            encodingAESKey: process.env.WECHAT_MESSAGE_AES_KEY || '',
            devBypass: devBypassEnabled('DEV_BYPASS_WECHAT'),
            devBypassOpenid: 'dev_test_openid',
        })] : []),
        ...((process.env.DOUYIN_AUTH_APP_ID || devBypassEnabled('DEV_BYPASS_DOUYIN')) ? [DouyinAuthPlugin.init({
            appId: process.env.DOUYIN_AUTH_APP_ID || 'dev_test_app_id',
            appSecret: process.env.DOUYIN_AUTH_APP_SECRET || 'dev_test_app_secret',
            devBypass: devBypassEnabled('DEV_BYPASS_DOUYIN'),
            devBypassOpenid: 'dev_test_openid',
        })] : []),
        OrderTimeoutPlugin.init({ defaultPaymentTimeoutMinutes: 30 }),
        InvoicePlugin.init({ provider: new PdfInvoiceProvider() }),
        GroupBuyPlugin.init({ defaultTimeoutMinutes: 60 }),
        FlashSalePlugin.init({ defaultTimeoutMinutes: 15 }),
        DistributionPlugin.init({
            defaultDirectRate: 1000,
            defaultIndirectRate: 500,
            minWithdrawalAmount: 10000,
            settlementDays: 7,
        }),
        // 医生工作台 SSO 桥接：baseUrl 指向 zhao-sso 中心（SSO_MOCK=true 时支持 mock-<手机号> 本地联调登录）
        TcmClinicPlugin.init({
            sso: {
                baseUrl: process.env.ZHAO_SSO_BASE_URL || '',
                mock: devBypassEnabled('SSO_MOCK'),
            },
        }),
        EcoPlugin.init(),
        ProductSurveyPlugin.init(),
        ...(process.env.REDIS_URL ? [RedisStockPlugin.init({
            redisUrl: process.env.REDIS_URL,
        })] : []),
        ...(process.env.KUAIDI100_CUSTOMER ? [LogisticsApiPlugin.init({
            customer: process.env.KUAIDI100_CUSTOMER,
            key: process.env.KUAIDI100_KEY ?? '',
        })] : []),
        InvoicePdfPlugin.init(),
        RechargeCardPlugin.init({ defaultExpiresMonths: 12 }),
        AfterSalesPlugin.init({
            afterSalesWindowHours: 24,         // 外卖售后窗口：送达后 24h
            afterSalesAutoApproveHours: 48,    // Pending 48h 未审自动同意并退款
            afterSalesRefundAutoRetry: 1,      // 退款失败自动重试 1 次
            allowedOrderStates: ['PaymentSettled', 'Delivered'], // 外卖单全程 PaymentSettled，确认收货后 Delivered
            // 送达门槛（外卖/骑手场景）：仅当订单有配送档案（deliveryStatus 有值）时要求已送达才可售后，
            // 防骑手单未送达双退款；普通快递/自提单无配送档案自动放行，走 maxDays+15 天窗口
            requireOrderCustomField: { field: 'deliveryStatus', value: 'delivered' },
        }),
        MemberLevelPlugin.init(),
        // 门店收银 POS：会员价依赖 MemberLevelPlugin；离线同步插件内部复用 VcashPosPlugin（同库/同渠道）
        VcashPosPlugin,
        VcashOfflinePlugin,
        CheckinPlugin.init(),
        FeedbackPlugin.init(),
        LotteryPlugin.init(),
        ShoppingCirclePlugin.init(),
        // 积分商城：商品收藏 + 积分兑换（依赖 MemberLevelPlugin 的积分账户，可选接 WechatpayPlugin 混合价支付）
        PointsMallPlugin.init(),
        ReviewPlugin.init(),
        // 商品收藏 / 店铺关注（toggle 语义，依赖 ShopPlugin 的 Shop 实体）
        FavoritePlugin.init(),
        WechatSubscribeMessagePlugin.init(),
        CouponPlugin.init(),
        // 服务型商品券包：支付成功自动发券 + C 端 myVouchers（首次上线，启动幂等建表）
        VoucherPlugin.init({}),
        MerchantPlugin.init(),
        // t3 代买单（委托单模式）：BP- 微信回调结算 / bill_pay_* 独立表，纯增量不触碰既有业务
        BillPayPlugin.init(),
        LiveStreamingPlugin.init({
            pushDomain: process.env.LIVE_PUSH_DOMAIN || 'rtmp://push.test.com/live/',
            playDomain: process.env.LIVE_PLAY_DOMAIN || 'https://play.test.com/live/',
            liveCommissionRate: Number(process.env.LIVE_COMMISSION_RATE || 1000),
            wsUrl: process.env.LIVE_WS_URL || 'ws://localhost:3003',
            wsSecret: process.env.LIVE_WS_SECRET || 'dev-live-secret',
        }),
        DeliveryPlugin.init(),
        // 校园配送（分区/宿舍楼/履约配置 + 骑手入驻/抢单大厅/送达分成），无 init，直接挂类
        CampusDeliveryPlugin,
        // 校园江湖：接 Strapi 文案源（h.joho.cn）。baseUrl/token 走 env，未配置或不可达时优雅回退实体内联文案
        CampusJianghuPlugin.init({
            contentApi: {
                baseUrl: process.env.JIANGHU_STRAPI_URL || 'https://h.joho.cn',
                token: process.env.JIANGHU_STRAPI_TOKEN,
                collection: 'jianghu-event-copies',
            },
        }),
        SalesPlugin.init(),
        MarketplacePlugin.init({}),
        // LogisticsPlugin 必须在 MarketplacePlugin 之后注册：两者都会设置 stockLocationStrategy，
        // 最后注册的 MatrixStockLocationStrategy（单一全局矩阵）需覆盖 Marketplace 的组合策略。
        // defaultCompleteDays：自动交易完成默认天数（Delivered 后 N 天），Channel.orderCompleteDays 可覆盖。
        // stockLocationStrategy：绑定感知策略（物理驱动变体只从绑定物理仓分配），覆盖默认 Matrix。
        LogisticsPlugin.init({
            defaultCompleteDays: 3,
            stockLocationStrategy: new PhysicalAwareStockLocationStrategy(),
        }),
        // 同城配送抽象网关：Provider 注册表 + Mock 配送商，必须在 LogisticsPlugin 之后注册（Task5）
        DeliveryGatewayPlugin.init({
            // 外部快递凭据一律走环境变量，不落 git、不用占位值：
            // 缺凭据时不注册对应 Provider（运营选派单会明确报「未注册的配送商」，而不是拿假 key 请求平台）。
            ...(process.env.DADA_APP_KEY && process.env.DADA_APP_SECRET
                ? {
                      dada: {
                          appKey: process.env.DADA_APP_KEY,
                          appSecret: process.env.DADA_APP_SECRET,
                          shopNo: process.env.DADA_SHOP_NO || '',
                          sourceId: process.env.DADA_SOURCE_ID || undefined,
                          environment: (process.env.DADA_ENV as 'sandbox' | 'production') || 'sandbox',
                          callbackUrl: process.env.DADA_CALLBACK_URL || '',
                      },
                  }
                : {}),
            ...(process.env.MEITUAN_APP_KEY && process.env.MEITUAN_APP_SECRET && process.env.MEITUAN_SHOP_ID
                ? {
                      meituan: {
                          appKey: process.env.MEITUAN_APP_KEY,
                          appSecret: process.env.MEITUAN_APP_SECRET,
                          shopId: process.env.MEITUAN_SHOP_ID,
                          signMode: process.env.MEITUAN_SIGN_MODE === 'open' ? 'open' : 'legacy',
                          baseUrl: process.env.MEITUAN_BASE_URL || undefined,
                          callbackUrl: process.env.MEITUAN_CALLBACK_URL || '',
                          defaultCourierPhone: process.env.MEITUAN_COURIER_PHONE || undefined,
                      },
                  }
                : {}),
        }),
        CustomerServicePlugin.init(),
        InventoryPlugin.init(),
        OperationsPlugin.init(),
        MessagePlugin.init(),
        NotificationPlugin.init(),
        // 预售/定金预售：两阶段支付（定金→尾款）+ 全款预售 + 分档定价 + 到货释放库存
        PreSalePlugin.init({}),
        PaymentSchedulePlugin.init({}),
        // 周期购订阅：套餐/订阅/期次 + 每日调度（首次上线，启动幂等建表）
        SubscriptionPlugin.init({}),
        InstallmentPlugin.init({}),
        RentalPlugin.init({}),
        // MeiliSearch 统一知识库：商品域直推 kb-zh/kb-en（索引前缀 kb，语言拆索引）。
        // 全部读 env（Task 6）；ZHAO_SEARCH_REINDEX_URL 指向 strapi zhao-search 管理路由，
        // 插件 admin 路由挂载规则为 /<pluginName><route.path>，Task 9 e2e 校准。
        MeiliSearchPlugin.init({
            host: process.env.MEILI_HOST ?? 'http://127.0.0.1:7700',
            adminKey: process.env.MEILI_ADMIN_KEY ?? '',
            indexPrefix: 'kb',
            locales: ['zh', 'en'],
            reindexUrl: process.env.ZHAO_SEARCH_REINDEX_URL,
            sharedSecret: process.env.ZHAO_SEARCH_SHARED_SECRET,
        }),
        // 微信公众号购物助手：文本消息搜索商品 → 客服消息卡片回复 → 回复编号下单 → H5 收银台支付。
        // 依赖 WechatAuthPlugin（消息回调）与 MeiliSearchPlugin（商品索引），随 WechatAuthPlugin 条件装配。
        // outboundMode=echo 时出站消息仅打日志（本地冒烟，不调微信 API）。
        ...((process.env.WECHAT_AUTH_APP_ID || process.env.DEV_BYPASS_WECHAT === 'true') ? [WechatShoppingAssistantPlugin.init({
            storefrontUrl: process.env.PUBLIC_STOREFRONT_URL || '',
            assetBaseUrl: process.env.PUBLIC_ASSET_URL || '',
            // hash 路由前端（如 vshop uni-app H5）的真实页面地址模板；未配置走 history 路由默认拼装
            productUrlTemplate: process.env.PUBLIC_PRODUCT_URL_TEMPLATE || '',
            loginUrlTemplate: process.env.PUBLIC_LOGIN_URL_TEMPLATE || '',
            payUrlTemplate: process.env.PUBLIC_PAY_URL_TEMPLATE || '',
            searchLocale: 'zh',
            sessionTtlMinutes: 30,
            searchLimit: 5,
            outboundMode: process.env.WECHAT_ASSISTANT_OUTBOUND_MODE === 'echo' ? 'echo' : 'api',
        })] : []),
        // 必须最后注册：覆盖 MarketplacePlugin 的 Seller 拆分，根治租户渠道商品的幽灵配送子单
        RelaxArrangingPaymentGuardPlugin,
        DisableSellerSplitPlugin,
    ],
};
// SYNTAX_ERROR_TEST: const x: = ;

function getDbConfig(): DataSourceOptions {
    const dbType = process.env.DB || 'mysql';
    switch (dbType) {
        case 'postgres':
            console.log('Using postgres connection');
            return {
                // 线上库长期自动同步后 order 表累计 1400+ 个已删列（attnum 逼近 1600 上限），
                // 再同步会报 "tables can have at most 1600 columns" 导致启动失败；
                // 可用 DB_SYNC=0 关闭自动同步（表结构已就绪时安全），新字段改走 migration。
                synchronize: process.env.DB_SYNC !== '0',
                type: 'postgres',
                host: process.env.DB_HOST || 'localhost',
                port: Number(process.env.DB_PORT) || 5432,
                username: process.env.DB_USERNAME || 'vendure',
                password: process.env.DB_PASSWORD || 'password',
                database: process.env.DB_NAME || 'vendure-dev',
                schema: process.env.DB_SCHEMA || 'public',
            };
        case 'sqlite':
            console.log('Using sqlite connection');
            return {
                synchronize: true,
                type: 'better-sqlite3',
                database: path.join(devServerDir, 'vendure.sqlite'),
            };
        case 'sqljs':
            console.log('Using sql.js connection');
            return {
                type: 'sqljs',
                autoSave: true,
                database: new Uint8Array([]),
                location: path.join(devServerDir, 'vendure.sqlite'),
            };
        case 'mysql':
        case 'mariadb':
        default:
            console.log('Using mysql connection');
            return {
                synchronize: true,
                type: 'mariadb',
                host: '127.0.0.1',
                port: 3306,
                username: 'vendure',
                password: 'password',
                database: 'vendure-dev',
            };
    }
}
