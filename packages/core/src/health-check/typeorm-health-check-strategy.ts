import { Injector } from '../common/injector';
import { HealthCheckStrategy } from '../config/system/health-check-strategy';
import { TransactionalConnection } from '../connection/transactional-connection';

import { HealthCheckError, HealthIndicatorFunction, HealthIndicatorResult } from './terminus-compat';

/**
 * @deprecated This interface is part of the deprecated health check feature and will be removed in v4.0.0.
 */
export interface TypeORMHealthCheckOptions {
    key?: string;
    timeout?: number;
}

/**
 * @description
 * A {@link HealthCheckStrategy} used to check the health of the database. This health
 * check is included by default, but can be customized by explicitly adding it to the
 * `systemOptions.healthChecks` array:
 *
 * @example
 * ```ts
 * import { TypeORMHealthCheckStrategy } from '\@vendure/core';
 *
 * export const config = {
 *   // ...
 *   systemOptions: {
 *     healthChecks:[
 *         // The default key is "database" and the default timeout is 1000ms
 *         // Sometimes this is too short and leads to false negatives in the
 *         // /health endpoint.
 *         new TypeORMHealthCheckStrategy({ key: 'postgres-db', timeout: 5000 }),
 *     ]
 *   }
 * }
 * ```
 *
 * @docsCategory health-check
 * @deprecated Use infrastructure-level health checks (e.g. Kubernetes probes, Docker healthchecks,
 * load balancer checks) instead of application-level health checks. This class will be removed in v4.0.0.
 */
export class TypeORMHealthCheckStrategy implements HealthCheckStrategy {
    private connection!: TransactionalConnection;

    constructor(private options?: TypeORMHealthCheckOptions) {}

    async init(injector: Injector) {
        this.connection = await injector.resolve(TransactionalConnection);
    }

    getHealthIndicator(): HealthIndicatorFunction {
        const key = this.options?.key || 'database';
        const timeout = this.options?.timeout ?? 1000;
        return async (): Promise<HealthIndicatorResult> => {
            let timer: NodeJS.Timeout | undefined;
            try {
                // SELECT 1 is valid for all drivers Vendure supports
                // (postgres, mysql, sqlite, better-sqlite3, sqljs); Oracle's
                // `SELECT 1 FROM DUAL` and SAP HANA's `SELECT now() FROM dummy`
                // variants are not needed because those drivers are not in
                // Vendure's supported set.
                // Note: TypeORM's DataSource.query() doesn't accept an AbortSignal,
                // so if the timeout fires the query continues in the background
                // until the driver itself gives up (or the connection drops). In
                // a degraded-DB scenario this can hold a pool connection per probe
                // — the cost is bounded by the pool size but worth knowing.
                await Promise.race([
                    this.connection.rawConnection.query('SELECT 1'),
                    new Promise<never>((_, reject) => {
                        timer = setTimeout(
                            () => reject(new Error(`database health check timed out after ${timeout}ms`)),
                            timeout,
                        );
                    }),
                ]);
                return { [key]: { status: 'up' } };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                throw new HealthCheckError(message, { [key]: { status: 'down', message } });
            } finally {
                if (timer) {
                    clearTimeout(timer);
                }
            }
        };
    }
}
