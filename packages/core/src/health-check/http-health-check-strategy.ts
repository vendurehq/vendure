import { Injectable, Scope } from '@nestjs/common';
import { HealthCheckError, HealthIndicatorFunction, HealthIndicatorResult } from '@nestjs/terminus';
import { HealthIndicator } from '@nestjs/terminus/dist/health-indicator/index';
import fetch from 'node-fetch';

import { Injector } from '../common/injector';
import { HealthCheckStrategy } from '../config/system/health-check-strategy';

/**
 * @deprecated This interface is part of the deprecated health check feature and will be removed in v4.0.0.
 */
export interface HttpHealthCheckOptions {
    key: string;
    url: string;
    timeout?: number;
}

/**
 * @description
 * A {@link HealthCheckStrategy} used to check health by pinging a url. Internally it uses
 * the [NestJS HttpHealthIndicator](https://docs.nestjs.com/recipes/terminus#http-healthcheck).
 *
 * @example
 * ```ts
 * import { HttpHealthCheckStrategy, TypeORMHealthCheckStrategy } from '\@vendure/core';
 *
 * export const config = {
 *   // ...
 *   systemOptions: {
 *     healthChecks: [
 *       new TypeORMHealthCheckStrategy(),
 *       new HttpHealthCheckStrategy({ key: 'my-service', url: 'https://my-service.com' }),
 *     ]
 *   },
 * };
 * ```
 *
 * @docsCategory health-check
 * @deprecated Use infrastructure-level health checks (e.g. Kubernetes probes, Docker healthchecks,
 * load balancer checks) instead of application-level health checks. This class will be removed in v4.0.0.
 */
export class HttpHealthCheckStrategy implements HealthCheckStrategy {
    constructor(private options: HttpHealthCheckOptions) {}
    private injector: Injector;

    init(injector: Injector) {
        this.injector = injector;
    }

    getHealthIndicator(): HealthIndicatorFunction {
        const { key, url, timeout } = this.options;
        return async () => {
            const indicator = await this.injector.resolve(CustomHttpHealthIndicator);
            return indicator.pingCheck(key, url, timeout);
        };
    }
}

/**
 * A much simplified version of the Terminus Modules' `HttpHealthIndicator` which has no
 * dependency on the @nestjs/axios package.
 *
 * @deprecated This class is part of the deprecated health check feature and will be removed in v4.0.0.
 */
@Injectable({
    scope: Scope.TRANSIENT,
})
export class CustomHttpHealthIndicator extends HealthIndicator {
    /**
     * Prepares and throw a HealthCheckError
     *
     * @throws {HealthCheckError}
     */
    private generateHttpError(key: string, error: any) {
        const response: { [key: string]: any } = {
            message: error.message,
        };
        if (error.response) {
            response.statusCode = error.response.status;
            response.statusText = error.response.statusText;
        }
        throw new HealthCheckError(error.message, this.getStatus(key, false, response));
    }

    async pingCheck(key: string, url: string, timeout?: number): Promise<HealthIndicatorResult> {
        let isHealthy = false;

        try {
            await fetch(url, { timeout });
            isHealthy = true;
        } catch (err) {
            this.generateHttpError(key, err);
        }

        return this.getStatus(key, isHealthy);
    }
}
