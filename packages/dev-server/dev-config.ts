/* eslint-disable no-console */
import { OnApplicationBootstrap } from '@nestjs/common';
import { AssetServerPlugin } from '@vendure/asset-server-plugin';
import { ADMIN_API_PATH, API_PORT, SHOP_API_PATH } from '@vendure/common/lib/shared-constants';
import {
    DefaultJobQueuePlugin,
    DefaultLogger,
    DefaultPasswordValidationStrategy,
    DefaultSchedulerPlugin,
    DefaultSearchPlugin,
    dummyPaymentHandler,
    LogLevel,
    PluginCommonModule,
    RequestContextService,
    SettingsStoreScopes,
    SettingsStoreService,
    VendureConfig,
    VendurePlugin,
} from '@vendure/core';
import { DashboardPlugin } from '@vendure/dashboard/plugin';
import { defaultEmailHandlers, EmailPlugin, FileBasedTemplateLoader } from '@vendure/email-plugin';
import { McpPlugin } from '@vendure/mcp-plugin';
import 'dotenv/config';
import { createRequire } from 'node:module';
import path from 'path';
import { DataSourceOptions } from 'typeorm';

import { NavModifierPlugin } from './test-plugins/nav-modifier-plugin/nav-modifier-plugin';
// import { FieldTestPlugin } from './test-plugins/field-test/field-test-plugin';
import { InsightsTestPlugin } from './test-plugins/insights-test/insights-test-plugin';
// import { ReviewsPlugin } from './test-plugins/reviews/reviews-plugin';

const IS_INSTRUMENTED = process.env.IS_INSTRUMENTED === 'true';
const SERVE_GRAPHIQL = process.env.VENDURE_SERVE_GRAPHIQL !== 'false';
const SERVE_STATIC_DASHBOARD = process.env.VENDURE_SERVE_STATIC_DASHBOARD !== 'false';
const loadPackage = createRequire(__filename);
const dashboardUrl = process.env.VENDURE_DASHBOARD_URL || 'http://localhost:3000/dashboard';
const dashboardAppDir =
    path.basename(__dirname) === 'dist'
        ? path.join(__dirname, './dashboard')
        : path.join(__dirname, './dist/dashboard');

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
 * Config settings used during development
 */
export const devConfig: VendureConfig = {
    apiOptions: {
        port: Number(process.env.PORT) || Number(process.env.API_PORT) || API_PORT,
        trustProxy: process.env.VENDURE_TRUST_PROXY === 'true',
        adminApiPath: ADMIN_API_PATH,
        shopApiPath: SHOP_API_PATH,
        // Local development only: reflect any origin, so the Dashboard Vite dev server and a
        // storefront on another port can call the API. The core default allows no cross-origin requests.
        cors: {
            origin: true,
            credentials: true,
        },
        // Local development only: add the project's stack frames to API errors.
        includeStackInErrors: true,
    },
    authOptions: {
        disableAuth: false,
        tokenMethod: ['bearer', 'cookie', 'api-key'] as const,
        requireVerification: true,
        // The populated test customers use the password 'test'.
        passwordValidationStrategy: new DefaultPasswordValidationStrategy({ minLength: 4, maxLength: 72 }),
        customPermissions: [],
        cookieOptions: {
            secret: 'abc',
        },
    },
    dbConnectionOptions: {
        synchronize: false,
        logging: false,
        ...getDbConfig(),
    },
    paymentOptions: {
        paymentMethodHandlers: [dummyPaymentHandler],
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
    customFields: {},
    logger: new DefaultLogger({ level: LogLevel.Verbose }),
    importExportOptions: {
        importAssetsDir: path.join(__dirname, 'import-assets'),
    },
    plugins: [
        // MultivendorPlugin.init({
        //     platformFeePercent: 10,
        //     platformFeeSKU: 'FEE',
        // }),
        ReadonlySettingsTestPlugin,
        // ReviewsPlugin,
        InsightsTestPlugin,
        // FieldTestPlugin,
        NavModifierPlugin,
        ...(SERVE_GRAPHIQL ? [loadPackage('@vendure/graphiql-plugin').GraphiqlPlugin.init()] : []),
        AssetServerPlugin.init({
            route: 'assets',
            assetUploadDir: path.join(__dirname, 'assets'),
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
            templateLoader: new FileBasedTemplateLoader(path.join(__dirname, '../email-plugin/templates')),
            outputPath: path.join(__dirname, 'test-emails'),
            globalTemplateVars: {
                verifyEmailAddressUrl: `${dashboardUrl}/verify`,
                passwordResetUrl: `${dashboardUrl}/reset-password`,
                changeEmailAddressUrl: `${dashboardUrl}/change-email-address`,
                adminPasswordResetUrl: `${dashboardUrl}/reset-password`,
            },
        }),
        // The Store MCP, which `vendure store check` and the MCP tools use. With no oauth block, the
        // CLI's local trust gives `vendure mcp` admin access, and `/mcp/shop` takes anonymous callers
        // by default.
        McpPlugin.init({}),
        ...(IS_INSTRUMENTED ? [loadPackage('@vendure/telemetry-plugin').TelemetryPlugin.init({})] : []),
        SERVE_STATIC_DASHBOARD
            ? DashboardPlugin.init({
                  route: 'dashboard',
                  appDir: dashboardAppDir,
              })
            : DashboardPlugin,
    ],
};

function getDbConfig(): DataSourceOptions {
    const dbType = process.env.DB || 'mysql';
    switch (dbType) {
        case 'postgres':
            console.log('Using postgres connection');
            return {
                synchronize: true,
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
                database: path.join(__dirname, 'vendure.sqlite'),
            };
        case 'sqljs':
            console.log('Using sql.js connection');
            return {
                type: 'sqljs',
                autoSave: true,
                database: new Uint8Array([]),
                location: path.join(__dirname, 'vendure.sqlite'),
            };
        case 'mysql':
        case 'mariadb':
        default:
            console.log('Using mysql connection');
            return {
                synchronize: true,
                // The files in ./migrations are generated for MySQL/MariaDB and use its syntax.
                // The other database types are created with `synchronize`, so they load none.
                migrations: [path.join(__dirname, 'migrations/*.ts')],
                type: 'mariadb',
                host: '127.0.0.1',
                port: 3306,
                username: 'vendure',
                password: 'password',
                database: 'vendure-dev',
            };
    }
}
