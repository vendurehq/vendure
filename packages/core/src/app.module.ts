import { MiddlewareConsumer, Module, NestModule, OnApplicationShutdown } from '@nestjs/common';
import cookieSession from 'cookie-session';

import { ApiModule } from './api/api.module';
import { Middleware, MiddlewareHandler } from './common';
import { ConfigModule } from './config/config.module';
import { ConfigService } from './config/config.service';
import { Logger } from './config/logger/vendure-logger';
import { ConnectionModule } from './connection/connection.module';
import { HealthCheckModule } from './health-check/health-check.module';
import { I18nModule } from './i18n/i18n.module';
import { I18nService } from './i18n/i18n.service';
import { PluginModule } from './plugin/plugin.module';
import { ProcessContextModule } from './process-context/process-context.module';
import { ServiceModule } from './service/service.module';
import { TelemetryModule } from './telemetry/telemetry.module';

@Module({
    imports: [
        ProcessContextModule,
        ConfigModule,
        I18nModule,
        ApiModule,
        PluginModule.forRoot(),
        HealthCheckModule,
        ServiceModule,
        ConnectionModule,
        TelemetryModule,
    ],
})
export class AppModule implements NestModule, OnApplicationShutdown {
    constructor(
        private configService: ConfigService,
        private i18nService: I18nService,
    ) {}

    configure(consumer: MiddlewareConsumer) {
        const { adminApiPath, shopApiPath, middleware } = this.configService.apiOptions;
        const { cookieOptions } = this.configService.authOptions;

        const i18nextHandler = this.i18nService.handle();
        const defaultMiddleware: Middleware[] = [
            { handler: i18nextHandler, route: adminApiPath },
            { handler: i18nextHandler, route: shopApiPath },
        ];

        const allMiddleware = defaultMiddleware.concat(middleware);

        // If the Admin API and Shop API should have specific cookies names, we need to create separate cookie sessions
        if (typeof cookieOptions?.name === 'object') {
            const shopApiCookieName = cookieOptions.name.shop;
            const adminApiCookieName = cookieOptions.name.admin;
            allMiddleware.push({
                handler: cookieSession({ ...cookieOptions, name: adminApiCookieName }),
                route: adminApiPath,
            });
            allMiddleware.push({
                handler: cookieSession({ ...cookieOptions, name: shopApiCookieName }),
                route: shopApiPath,
            });
        }

        const consumableMiddlewares = allMiddleware.filter(mid => !mid.beforeListen);
        const middlewareByRoute = this.groupMiddlewareByRoute(consumableMiddlewares);

        for (const [route, handlers] of Object.entries(middlewareByRoute)) {
            consumer.apply(...handlers).forRoutes(route);
        }
    }

    async onApplicationShutdown(signal?: string) {
        if (signal) {
            Logger.info('Received shutdown signal:' + signal);
        }
    }

    /**
     * Groups middleware handler together in an object with the route as the key.
     */
    private groupMiddlewareByRoute(middlewareArray: Middleware[]): { [route: string]: MiddlewareHandler[] } {
        const result = {} as { [route: string]: MiddlewareHandler[] };
        for (const middleware of middlewareArray) {
            const route = middleware.route || this.configService.apiOptions.adminApiPath;
            if (!result[route]) {
                result[route] = [];
            }
            result[route].push(middleware.handler);
        }
        return result;
    }
}
