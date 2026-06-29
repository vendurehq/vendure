/* eslint-disable no-console */
import { OnApplicationBootstrap } from '@nestjs/common';
import { AdminUiPlugin } from '@vendure/admin-ui-plugin';
import { AssetServerPlugin } from '@vendure/asset-server-plugin';
import { ADMIN_API_PATH, API_PORT, SHOP_API_PATH } from '@vendure/common/lib/shared-constants';
import {
    DefaultJobQueuePlugin,
    DefaultLogger,
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
import { GraphiqlPlugin } from '@vendure/graphiql-plugin';
import { TelemetryPlugin } from '@vendure/telemetry-plugin';
import 'dotenv/config';
import path from 'path';
import { DataSourceOptions } from 'typeorm';
import { NavModifierPlugin } from './test-plugins/nav-modifier-plugin/nav-modifier-plugin';
// import { FieldTestPlugin } from './test-plugins/field-test/field-test-plugin';
import { ReviewsPlugin } from './test-plugins/reviews/reviews-plugin';

const IS_INSTRUMENTED = process.env.IS_INSTRUMENTED === 'true';

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
        port: Number(process.env.API_PORT) || API_PORT,
        adminApiPath: ADMIN_API_PATH,
        adminApiPlayground: {
            settings: {
                'request.credentials': 'include',
            },
        },
        adminApiDebug: true,
        shopApiPath: SHOP_API_PATH,
        shopApiPlayground: {
            settings: {
                'request.credentials': 'include',
            },
        },
        shopApiDebug: true,
    },
    authOptions: {
        disableAuth: false,
        tokenMethod: ['bearer', 'cookie', 'api-key'] as const,
        requireVerification: true,
        customPermissions: [],
        cookieOptions: {
            secret: 'abc',
        },
    },
    dbConnectionOptions: {
        synchronize: false,
        logging: false,
        migrations: [path.join(__dirname, 'migrations/*.ts')],
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
        ReviewsPlugin,
        // FieldTestPlugin,
        NavModifierPlugin,
        GraphiqlPlugin.init(),
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
                verifyEmailAddressUrl: 'http://localhost:4201/verify',
                passwordResetUrl: 'http://localhost:4201/reset-password',
                changeEmailAddressUrl: 'http://localhost:4201/change-email-address',
            },
        }),
        ...(IS_INSTRUMENTED ? [TelemetryPlugin.init({})] : []),
        // AdminUiPlugin.init({
        //     route: 'admin',
        //     port: 5001,
        //     adminUiConfig: {},
        //     // Un-comment to compile a custom admin ui
        //     // app: compileUiExtensions({
        //     //     outputPath: path.join(__dirname, './custom-admin-ui'),
        //     //     extensions: [
        //     //         {
        //     //             id: 'ui-extensions-library',
        //     //             extensionPath: path.join(__dirname, 'example-plugins/ui-extensions-library/ui'),
        //     //             routes: [{ route: 'ui-library', filePath: 'routes.ts' }],
        //     //             providers: ['providers.ts'],
        //     //         },
        //     //         {
        //     //             globalStyles: path.join(
        //     //                 __dirname,
        //     //                 'test-plugins/with-ui-extension/ui/custom-theme.scss',
        //     //             ),
        //     //         },
        //     //     ],
        //     //     devMode: true,
        //     // }),
        // }),
        AdminUiPlugin.init({
            route: 'admin',
            port: 5001,
            adminUiConfig: {},
            // Un-comment to compile a custom admin ui
            // app: compileUiExtensions({
            //     outputPath: path.join(__dirname, './custom-admin-ui'),
            //     extensions: [
            //         {
            //             id: 'ui-extensions-library',
            //             extensionPath: path.join(__dirname, 'example-plugins/ui-extensions-library/ui'),
            //             routes: [{ route: 'ui-library', filePath: 'routes.ts' }],
            //             providers: ['providers.ts'],
            //         },
            //         {
            //             globalStyles: path.join(
            //                 __dirname,
            //                 'test-plugins/with-ui-extension/ui/custom-theme.scss',
            //             ),
            //         },
            //     ],
            //     devMode: true,
            // }),
        }),
        DashboardPlugin.init({
            route: 'dashboard',
            appDir: path.join(__dirname, './dist'),
        }),
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
                type: 'mariadb',
                host: '127.0.0.1',
                port: 3306,
                username: 'vendure',
                password: 'password',
                database: 'vendure-dev',
            };
    }
}
