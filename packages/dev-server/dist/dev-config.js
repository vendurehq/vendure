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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
Object.defineProperty(exports, "__esModule", { value: true });
exports.devConfig = void 0;
const admin_ui_plugin_1 = require("@vendure/admin-ui-plugin");
const asset_server_plugin_1 = require("@vendure/asset-server-plugin");
const shared_constants_1 = require("@vendure/common/lib/shared-constants");
const core_1 = require("@vendure/core");
const plugin_1 = require("@vendure/dashboard/plugin");
const email_plugin_1 = require("@vendure/email-plugin");
const graphiql_plugin_1 = require("@vendure/graphiql-plugin");
const harden_plugin_1 = require("@vendure/harden-plugin");
const telemetry_plugin_1 = require("@vendure/telemetry-plugin");
require("dotenv/config");
const path_1 = __importDefault(require("path"));
const cjk_plugin_1 = require("@vendure/cjk-plugin");
const graphql_depth_limit_1 = require("./graphql-depth-limit");
const login_rate_limit_1 = require("./login-rate-limit");
const alipay_plugin_1 = require("@vendure/alipay-plugin");
const wechatpay_plugin_1 = require("@vendure/wechatpay-plugin");
const oss_plugin_1 = require("@vendure/oss-plugin");
const phone_auth_plugin_1 = require("@vendure/phone-auth-plugin");
const wechat_auth_plugin_1 = require("@vendure/wechat-auth-plugin");
const douyin_auth_plugin_1 = require("@vendure/douyin-auth-plugin");
const order_timeout_plugin_1 = require("@vendure/order-timeout-plugin");
const invoice_plugin_1 = require("@vendure/invoice-plugin");
const logistics_plugin_1 = require("@vendure/logistics-plugin");
const delivery_gateway_plugin_1 = require("@vendure/delivery-gateway-plugin");
const group_buy_plugin_1 = require("@vendure/group-buy-plugin");
const flash_sale_plugin_1 = require("@vendure/flash-sale-plugin");
const distribution_plugin_1 = require("@vendure/distribution-plugin");
const eco_plugin_1 = require("@vendure/eco-plugin");
const product_survey_plugin_1 = require("@vendure/product-survey-plugin");
const redis_stock_plugin_1 = require("@vendure/redis-stock-plugin");
const logistics_api_plugin_1 = require("@vendure/logistics-api-plugin");
const invoice_pdf_plugin_1 = require("@vendure/invoice-pdf-plugin");
const recharge_card_plugin_1 = require("@vendure/recharge-card-plugin");
const after_sales_plugin_1 = require("@vendure/after-sales-plugin");
const member_level_plugin_1 = require("@vendure/member-level-plugin");
const vcash_pos_plugin_1 = require("@vendure/vcash-pos-plugin");
const vcash_offline_plugin_1 = require("@vendure/vcash-offline-plugin");
const checkin_plugin_1 = require("@vendure/checkin-plugin");
const feedback_plugin_1 = require("@vendure/feedback-plugin");
const lottery_plugin_1 = require("@vendure/lottery-plugin");
const shopping_circle_plugin_1 = require("@vendure/shopping-circle-plugin");
const points_mall_plugin_1 = require("@vendure/points-mall-plugin");
const review_plugin_1 = require("@vendure/review-plugin");
const wechat_subscribe_message_plugin_1 = require("@vendure/wechat-subscribe-message-plugin");
const coupon_plugin_1 = require("@vendure/coupon-plugin");
const merchant_plugin_1 = require("@vendure/merchant-plugin");
const bill_pay_plugin_1 = require("@vendure/bill-pay-plugin");
const campus_delivery_plugin_1 = require("@vendure/campus-delivery-plugin");
const campus_jianghu_plugin_1 = require("@vendure/campus-jianghu-plugin");
const delivery_plugin_1 = require("@vendure/delivery-plugin");
const sales_plugin_1 = require("@vendure/sales-plugin");
const sales_plugin_2 = require("@vendure/sales-plugin");
const marketplace_plugin_1 = require("@vendure/marketplace-plugin");
const customer_service_plugin_1 = require("@vendure/customer-service-plugin");
const inventory_plugin_1 = require("@vendure/inventory-plugin");
const message_plugin_1 = require("@vendure/message-plugin");
const notification_plugin_1 = require("@vendure/notification-plugin");
const operations_plugin_1 = require("@vendure/operations-plugin");
const pre_sale_plugin_1 = require("@vendure/pre-sale-plugin");
const payment_schedule_plugin_1 = require("@vendure/payment-schedule-plugin");
const installment_plugin_1 = require("@vendure/installment-plugin");
const rental_plugin_1 = require("@vendure/rental-plugin");
const live_streaming_plugin_1 = require("@vendure/live-streaming-plugin");
const shop_plugin_1 = require("@vendure/shop-plugin");
const pickup_plugin_1 = require("@vendure/pickup-plugin");
const shop_template_plugin_1 = require("@vendure/shop-template-plugin");
const diy_plugin_1 = require("@vendure/diy-plugin");
const favorite_plugin_1 = require("@vendure/favorite-plugin");
const tcm_clinic_plugin_1 = require("@vendure/tcm-clinic-plugin");
const meilisearch_plugin_1 = require("@vendure/meilisearch-plugin");
const wechat_shopping_assistant_plugin_1 = require("@vendure/wechat-shopping-assistant-plugin");
if (!process.env.REDEMPTION_KEY) {
    process.env.REDEMPTION_KEY = 'd'.repeat(64);
}
const IS_PROD = path_1.default.basename(__dirname) === 'dist' || process.env.IS_PROD === 'true';
const devOnlyPlugins = IS_PROD
    ? []
    : (() => {
        const { ReviewsPlugin } = require('./test-plugins/reviews/reviews-plugin');
        const { FloorBuilderPlugin } = require('./test-plugins/floor-builder');
        const { NavModifierPlugin } = require('./test-plugins/nav-modifier-plugin/nav-modifier-plugin');
        return [ReviewsPlugin, FloorBuilderPlugin, NavModifierPlugin];
    })();
const devServerDir = path_1.default.basename(__dirname) === 'dist' ? path_1.default.dirname(__dirname) : __dirname;
const IS_INSTRUMENTED = process.env.IS_INSTRUMENTED === 'true';
const IS_NODE_PROD = process.env.NODE_ENV === 'production';
const ALLOW_DEV_BYPASS = !IS_PROD && !IS_NODE_PROD;
const devBypassEnabled = (envName) => ALLOW_DEV_BYPASS && process.env[envName] === 'true';
let ReadonlySettingsTestPlugin = class ReadonlySettingsTestPlugin {
    constructor(settingsStoreService, requestContextService) {
        this.settingsStoreService = settingsStoreService;
        this.requestContextService = requestContextService;
    }
    async onApplicationBootstrap() {
        const ctx = await this.requestContextService.create({ apiType: 'admin' });
        await this.settingsStoreService.set(ctx, 'ReadonlyTest.buildVersion', 'v3.5.2');
        await this.settingsStoreService.set(ctx, 'ReadonlyTest.buildMeta', {
            buildDate: '2026-03-06',
            commit: 'd0384f3ed',
            features: ['settings-store-ui', 'option-groups'],
        });
    }
};
ReadonlySettingsTestPlugin = __decorate([
    (0, core_1.VendurePlugin)({
        imports: [core_1.PluginCommonModule],
        configuration: config => {
            config.settingsStoreFields = Object.assign(Object.assign({}, config.settingsStoreFields), { ReadonlyTest: [
                    { name: 'buildVersion', readonly: true },
                    { name: 'buildMeta', readonly: true },
                ] });
            return config;
        },
    }),
    __metadata("design:paramtypes", [core_1.SettingsStoreService,
        core_1.RequestContextService])
], ReadonlySettingsTestPlugin);
let DisableSellerSplitPlugin = class DisableSellerSplitPlugin {
};
DisableSellerSplitPlugin = __decorate([
    (0, core_1.VendurePlugin)({
        configuration: config => {
            config.orderOptions.orderSellerStrategy = new core_1.DefaultOrderSellerStrategy();
            return config;
        },
    })
], DisableSellerSplitPlugin);
let RelaxArrangingPaymentGuardPlugin = class RelaxArrangingPaymentGuardPlugin {
};
RelaxArrangingPaymentGuardPlugin = __decorate([
    (0, core_1.VendurePlugin)({
        configuration: config => {
            var _a;
            const existing = ((_a = config.orderOptions.process) !== null && _a !== void 0 ? _a : []).filter(p => !p.__isDefaultOrderProcess);
            config.orderOptions.process = [
                (0, core_1.configureDefaultOrderProcess)({
                    checkFulfillmentStates: false,
                    arrangingPaymentRequiresCustomer: false,
                    arrangingPaymentRequiresShipping: false,
                }),
                ...existing,
            ];
            return config;
        },
    })
], RelaxArrangingPaymentGuardPlugin);
exports.devConfig = {
    apiOptions: {
        port: Number(process.env.API_PORT) || shared_constants_1.API_PORT,
        adminApiPath: shared_constants_1.ADMIN_API_PATH,
        adminApiPlayground: IS_PROD
            ? false
            : {
                settings: {
                    'request.credentials': 'include',
                },
            },
        adminApiDebug: !IS_PROD,
        shopApiPath: shared_constants_1.SHOP_API_PATH,
        shopApiPlayground: IS_PROD
            ? false
            : {
                settings: {
                    'request.credentials': 'include',
                },
            },
        shopApiDebug: !IS_PROD,
        trustProxy: 1,
        adminApiValidationRules: [(0, graphql_depth_limit_1.createDepthLimitRule)(12)],
        shopApiValidationRules: [(0, graphql_depth_limit_1.createDepthLimitRule)(12)],
        middleware: [
            {
                handler: (req, res, next) => {
                    if (req.path.startsWith('/assets') || req.url.startsWith('/assets')) {
                        res.setHeader('Access-Control-Allow-Origin', '*');
                    }
                    next();
                },
                route: '/assets',
            },
            {
                handler: (req, res, next) => {
                    if (req.method === 'GET' && !req.query.query) {
                        res.status(200).json({
                            data: null,
                            errors: [
                                {
                                    message: 'GET requests to the GraphQL Admin API require a "query" parameter. Use POST or include ?query=.',
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
            {
                handler: login_rate_limit_1.loginRateLimit,
                route: '/shop-api',
            },
            {
                handler: login_rate_limit_1.loginRateLimit,
                route: '/admin-api',
            },
        ],
    },
    authOptions: {
        disableAuth: false,
        tokenMethod: ['bearer', 'cookie', 'api-key'],
        requireVerification: false,
        customPermissions: [
            new core_1.PermissionDefinition({
                name: 'TenantSettingsManage',
                description: '管理本渠道租户配置（支付/地图/登录方式等）',
            }),
            new core_1.PermissionDefinition({
                name: 'TenantPromotionManage',
                description: '管理本渠道营销活动（秒杀/拼团/预售）',
            }),
        ],
        cookieOptions: {
            secret: process.env.COOKIE_SECRET || 'abc',
        },
    },
    dbConnectionOptions: Object.assign({ synchronize: false, logging: process.env.SQL_LOG === '1' ? ['query', 'error'] : false, logger: process.env.SQL_LOG === '1' ? 'simple-console' : undefined, migrations: [path_1.default.join(devServerDir, 'migrations/*.ts')] }, getDbConfig()),
    paymentOptions: {
        paymentMethodHandlers: [core_1.dummyPaymentHandler],
    },
    orderOptions: {
        orderItemPriceCalculationStrategy: new sales_plugin_2.SalesOrderItemPriceCalculationStrategy(),
        orderByCodeAccessStrategy: new core_1.DefaultOrderByCodeAccessStrategy('7d'),
    },
    settingsStoreFields: {
        MyPlugin: [
            {
                name: 'globalVal',
            },
            {
                name: 'userVal',
                scope: core_1.SettingsStoreScopes.user,
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
            { name: 'displayTemplate', type: 'string', defaultValue: 'standard', public: true },
            { name: 'themeId', type: 'string', defaultValue: 'taobao-orange', public: true },
            { name: 'balanceMinWithdrawalAmount', type: 'int', nullable: true, public: true,
                label: [{ languageCode: core_1.LanguageCode.zh_Hans, value: '余额提现起提金额(分)' }] },
            { name: 'lotteryFixedCost', type: 'int', nullable: true, public: true,
                label: [{ languageCode: core_1.LanguageCode.zh_Hans, value: '抽奖每次固定消耗(积分)' }] },
            { name: 'shopName', type: 'string', public: true },
            { name: 'shopLogo', type: 'string', public: true },
            { name: 'shopIntro', type: 'string', public: true },
            { name: 'servicePhone', type: 'string', public: true },
            { name: 'shopContent', type: 'text', public: true },
            { name: 'detailConfig', type: 'text', public: true },
            { name: 'orderDetailConfig', type: 'text', public: true },
            { name: 'orderListConfig', type: 'text', public: true },
            { name: 'promoSchemes', type: 'text', public: true },
            { name: 'serviceSchemes', type: 'text', public: true },
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
        runTasksInWorkerOnly: false,
        tasks: [core_1.cleanSessionsTask, core_1.cleanOrphanedSettingsStoreTask],
    },
    logger: new core_1.DefaultLogger({ level: IS_PROD ? core_1.LogLevel.Info : core_1.LogLevel.Verbose }),
    importExportOptions: {
        importAssetsDir: path_1.default.join(devServerDir, 'import-assets'),
    },
    plugins: [
        ReadonlySettingsTestPlugin,
        ...(IS_PROD ? [harden_plugin_1.HardenPlugin.init({ maxQueryComplexity: 3000, apiMode: 'prod' })] : []),
        ...devOnlyPlugins,
        ...(IS_PROD ? [] : [graphiql_plugin_1.GraphiqlPlugin.init()]),
        asset_server_plugin_1.AssetServerPlugin.init({
            route: 'assets',
            assetUploadDir: path_1.default.join(devServerDir, 'assets'),
        }),
        core_1.DefaultSearchPlugin.init({ bufferUpdates: false, indexStockStatus: false }),
        core_1.DefaultJobQueuePlugin.init({}),
        core_1.DefaultSchedulerPlugin.init({}),
        email_plugin_1.EmailPlugin.init({
            devMode: true,
            route: 'mailbox',
            handlers: email_plugin_1.defaultEmailHandlers,
            templateLoader: new email_plugin_1.FileBasedTemplateLoader(path_1.default.join(devServerDir, '../email-plugin/templates')),
            outputPath: path_1.default.join(devServerDir, 'test-emails'),
            globalTemplateVars: {
                verifyEmailAddressUrl: 'http://localhost:4201/verify',
                passwordResetUrl: 'http://localhost:4201/reset-password',
                changeEmailAddressUrl: 'http://localhost:4201/change-email-address',
            },
        }),
        ...(IS_INSTRUMENTED ? [telemetry_plugin_1.TelemetryPlugin.init({})] : []),
        admin_ui_plugin_1.AdminUiPlugin.init({
            route: 'admin',
            port: 5001,
            adminUiConfig: {},
        }),
        plugin_1.DashboardPlugin.init({
            route: 'dashboard',
            appDir: path_1.default.join(devServerDir, './dist'),
        }),
        cjk_plugin_1.CjkPlugin.init({
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
        shop_plugin_1.ShopPlugin.init({}),
        shop_template_plugin_1.ShopTemplatePlugin.init({ app: (_a = process.env.APP) !== null && _a !== void 0 ? _a : 'nshop' }),
        diy_plugin_1.DiyPlugin.init({ app: (_b = process.env.APP) !== null && _b !== void 0 ? _b : 'nshop' }),
        pickup_plugin_1.PickupPlugin.init({}),
        ...((process.env.ALIPAY_NOTIFY_URL || devBypassEnabled('DEV_BYPASS_ALIPAY')) ? [alipay_plugin_1.AlipayPlugin.init({
                notifyUrl: process.env.ALIPAY_NOTIFY_URL || '',
                alipayPublicKey: (_c = process.env.ALIPAY_PUBLIC_KEY) !== null && _c !== void 0 ? _c : '',
                sellerId: process.env.ALIPAY_SELLER_ID || undefined,
                auth: devBypassEnabled('DEV_BYPASS_ALIPAY') ? {
                    devBypass: true,
                    devBypassOpenid: 'dev_test_openid',
                } : undefined,
            })] : []),
        wechatpay_plugin_1.WechatpayPlugin.init({
            notifyUrl: process.env.WECHATPAY_NOTIFY_URL || '',
            devBypass: devBypassEnabled('DEV_BYPASS_WECHATPAY'),
            devBypassOpenid: 'dev_test_openid',
            extraHandlerCodes: (process.env.WECHATPAY_EXTRA_HANDLER_CODES || '')
                .split(',').map(s => s.trim()).filter(Boolean),
            callbackMethodMap: process.env.WECHATPAY_CALLBACK_METHOD_MAP
                ? JSON.parse(process.env.WECHATPAY_CALLBACK_METHOD_MAP)
                : undefined,
        }),
        ...(process.env.OSS_ACCESS_KEY_ID ? [oss_plugin_1.OssPlugin.init({
                region: (_d = process.env.OSS_REGION) !== null && _d !== void 0 ? _d : '',
                accessKeyId: (_e = process.env.OSS_ACCESS_KEY_ID) !== null && _e !== void 0 ? _e : '',
                accessKeySecret: (_f = process.env.OSS_ACCESS_KEY_SECRET) !== null && _f !== void 0 ? _f : '',
                bucket: (_g = process.env.OSS_BUCKET) !== null && _g !== void 0 ? _g : '',
            })] : []),
        phone_auth_plugin_1.PhoneAuthPlugin.init({
            accessKeyId: process.env.SMS_ACCESS_KEY_ID || '',
            accessKeySecret: (_h = process.env.SMS_ACCESS_KEY_SECRET) !== null && _h !== void 0 ? _h : '',
            signName: (_j = process.env.SMS_SIGN_NAME) !== null && _j !== void 0 ? _j : '',
            templateCode: (_k = process.env.SMS_TEMPLATE_CODE) !== null && _k !== void 0 ? _k : '',
            devBypass: devBypassEnabled('DEV_BYPASS_SMS'),
            devBypassCode: '123456',
            redisUrl: process.env.PHONE_AUTH_REDIS_URL || undefined,
        }),
        ...((process.env.WECHAT_AUTH_APP_ID || devBypassEnabled('DEV_BYPASS_WECHAT')) ? [wechat_auth_plugin_1.WechatAuthPlugin.init({
                appId: process.env.WECHAT_AUTH_APP_ID || 'dev_test_app_id',
                appSecret: process.env.WECHAT_AUTH_APP_SECRET || 'dev_test_app_secret',
                miniProgramAppId: process.env.WECHAT_AUTH_MINI_APP_ID || '',
                miniProgramAppSecret: process.env.WECHAT_AUTH_MINI_APP_SECRET || '',
                token: process.env.WECHAT_MESSAGE_TOKEN || '',
                encodingAESKey: process.env.WECHAT_MESSAGE_AES_KEY || '',
                devBypass: devBypassEnabled('DEV_BYPASS_WECHAT'),
                devBypassOpenid: 'dev_test_openid',
            })] : []),
        ...((process.env.DOUYIN_AUTH_APP_ID || devBypassEnabled('DEV_BYPASS_DOUYIN')) ? [douyin_auth_plugin_1.DouyinAuthPlugin.init({
                appId: process.env.DOUYIN_AUTH_APP_ID || 'dev_test_app_id',
                appSecret: process.env.DOUYIN_AUTH_APP_SECRET || 'dev_test_app_secret',
                devBypass: devBypassEnabled('DEV_BYPASS_DOUYIN'),
                devBypassOpenid: 'dev_test_openid',
            })] : []),
        order_timeout_plugin_1.OrderTimeoutPlugin.init({ defaultPaymentTimeoutMinutes: 30 }),
        invoice_plugin_1.InvoicePlugin.init({ provider: new invoice_pdf_plugin_1.PdfInvoiceProvider() }),
        group_buy_plugin_1.GroupBuyPlugin.init({ defaultTimeoutMinutes: 60 }),
        flash_sale_plugin_1.FlashSalePlugin.init({ defaultTimeoutMinutes: 15 }),
        distribution_plugin_1.DistributionPlugin.init({
            defaultDirectRate: 1000,
            defaultIndirectRate: 500,
            minWithdrawalAmount: 10000,
            settlementDays: 7,
        }),
        tcm_clinic_plugin_1.TcmClinicPlugin.init({
            sso: {
                baseUrl: process.env.ZHAO_SSO_BASE_URL || '',
                mock: devBypassEnabled('SSO_MOCK'),
            },
        }),
        eco_plugin_1.EcoPlugin.init(),
        product_survey_plugin_1.ProductSurveyPlugin.init(),
        ...(process.env.REDIS_URL ? [redis_stock_plugin_1.RedisStockPlugin.init({
                redisUrl: process.env.REDIS_URL,
            })] : []),
        ...(process.env.KUAIDI100_CUSTOMER ? [logistics_api_plugin_1.LogisticsApiPlugin.init({
                customer: process.env.KUAIDI100_CUSTOMER,
                key: (_l = process.env.KUAIDI100_KEY) !== null && _l !== void 0 ? _l : '',
            })] : []),
        invoice_pdf_plugin_1.InvoicePdfPlugin.init(),
        recharge_card_plugin_1.RechargeCardPlugin.init({ defaultExpiresMonths: 12 }),
        after_sales_plugin_1.AfterSalesPlugin.init({
            afterSalesWindowHours: 24,
            afterSalesAutoApproveHours: 48,
            afterSalesRefundAutoRetry: 1,
            allowedOrderStates: ['PaymentSettled', 'Delivered'],
            requireOrderCustomField: { field: 'deliveryStatus', value: 'delivered' },
        }),
        member_level_plugin_1.MemberLevelPlugin.init(),
        vcash_pos_plugin_1.VcashPosPlugin,
        vcash_offline_plugin_1.VcashOfflinePlugin,
        checkin_plugin_1.CheckinPlugin.init(),
        feedback_plugin_1.FeedbackPlugin.init(),
        lottery_plugin_1.LotteryPlugin.init(),
        shopping_circle_plugin_1.ShoppingCirclePlugin.init(),
        points_mall_plugin_1.PointsMallPlugin.init(),
        review_plugin_1.ReviewPlugin.init(),
        favorite_plugin_1.FavoritePlugin.init(),
        wechat_subscribe_message_plugin_1.WechatSubscribeMessagePlugin.init(),
        coupon_plugin_1.CouponPlugin.init(),
        merchant_plugin_1.MerchantPlugin.init(),
        bill_pay_plugin_1.BillPayPlugin.init(),
        live_streaming_plugin_1.LiveStreamingPlugin.init({
            pushDomain: process.env.LIVE_PUSH_DOMAIN || 'rtmp://push.test.com/live/',
            playDomain: process.env.LIVE_PLAY_DOMAIN || 'https://play.test.com/live/',
            liveCommissionRate: Number(process.env.LIVE_COMMISSION_RATE || 1000),
            wsUrl: process.env.LIVE_WS_URL || 'ws://localhost:3003',
            wsSecret: process.env.LIVE_WS_SECRET || 'dev-live-secret',
        }),
        delivery_plugin_1.DeliveryPlugin.init(),
        campus_delivery_plugin_1.CampusDeliveryPlugin,
        campus_jianghu_plugin_1.CampusJianghuPlugin.init({
            contentApi: {
                baseUrl: process.env.JIANGHU_STRAPI_URL || 'https://h.joho.cn',
                token: process.env.JIANGHU_STRAPI_TOKEN,
                collection: 'jianghu-event-copies',
            },
        }),
        sales_plugin_1.SalesPlugin.init(),
        marketplace_plugin_1.MarketplacePlugin.init({}),
        logistics_plugin_1.LogisticsPlugin.init({
            defaultCompleteDays: 3,
            stockLocationStrategy: new cjk_plugin_1.PhysicalAwareStockLocationStrategy(),
        }),
        delivery_gateway_plugin_1.DeliveryGatewayPlugin.init(Object.assign(Object.assign({}, (process.env.DADA_APP_KEY && process.env.DADA_APP_SECRET
            ? {
                dada: {
                    appKey: process.env.DADA_APP_KEY,
                    appSecret: process.env.DADA_APP_SECRET,
                    shopNo: process.env.DADA_SHOP_NO || '',
                    sourceId: process.env.DADA_SOURCE_ID || undefined,
                    environment: process.env.DADA_ENV || 'sandbox',
                    callbackUrl: process.env.DADA_CALLBACK_URL || '',
                },
            }
            : {})), (process.env.MEITUAN_APP_KEY && process.env.MEITUAN_APP_SECRET && process.env.MEITUAN_SHOP_ID
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
            : {}))),
        customer_service_plugin_1.CustomerServicePlugin.init(),
        inventory_plugin_1.InventoryPlugin.init(),
        operations_plugin_1.OperationsPlugin.init(),
        message_plugin_1.MessagePlugin.init(),
        notification_plugin_1.NotificationPlugin.init(),
        pre_sale_plugin_1.PreSalePlugin.init({}),
        payment_schedule_plugin_1.PaymentSchedulePlugin.init({}),
        installment_plugin_1.InstallmentPlugin.init({}),
        rental_plugin_1.RentalPlugin.init({}),
        meilisearch_plugin_1.MeiliSearchPlugin.init({
            host: (_m = process.env.MEILI_HOST) !== null && _m !== void 0 ? _m : 'http://127.0.0.1:7700',
            adminKey: (_o = process.env.MEILI_ADMIN_KEY) !== null && _o !== void 0 ? _o : '',
            indexPrefix: 'kb',
            locales: ['zh', 'en'],
            reindexUrl: process.env.ZHAO_SEARCH_REINDEX_URL,
            sharedSecret: process.env.ZHAO_SEARCH_SHARED_SECRET,
        }),
        ...((process.env.WECHAT_AUTH_APP_ID || process.env.DEV_BYPASS_WECHAT === 'true') ? [wechat_shopping_assistant_plugin_1.WechatShoppingAssistantPlugin.init({
                storefrontUrl: process.env.PUBLIC_STOREFRONT_URL || '',
                assetBaseUrl: process.env.PUBLIC_ASSET_URL || '',
                productUrlTemplate: process.env.PUBLIC_PRODUCT_URL_TEMPLATE || '',
                loginUrlTemplate: process.env.PUBLIC_LOGIN_URL_TEMPLATE || '',
                payUrlTemplate: process.env.PUBLIC_PAY_URL_TEMPLATE || '',
                searchLocale: 'zh',
                sessionTtlMinutes: 30,
                searchLimit: 5,
                outboundMode: process.env.WECHAT_ASSISTANT_OUTBOUND_MODE === 'echo' ? 'echo' : 'api',
            })] : []),
        RelaxArrangingPaymentGuardPlugin,
        DisableSellerSplitPlugin,
    ],
};
function getDbConfig() {
    const dbType = process.env.DB || 'mysql';
    switch (dbType) {
        case 'postgres':
            console.log('Using postgres connection');
            return {
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
                database: path_1.default.join(devServerDir, 'vendure.sqlite'),
            };
        case 'sqljs':
            console.log('Using sql.js connection');
            return {
                type: 'sqljs',
                autoSave: true,
                database: new Uint8Array([]),
                location: path_1.default.join(devServerDir, 'vendure.sqlite'),
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
