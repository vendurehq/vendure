import { Injectable } from '@nestjs/common';

import { TransactionalConnection } from '../../connection/transactional-connection';
import { ApiKey } from '../../entity/api-key/api-key.entity';
import { Channel } from '../../entity/channel/channel.entity';
import { Seller } from '../../entity/seller/seller.entity';
import { StockLocation } from '../../entity/stock-location/stock-location.entity';
import { TelemetryConfig, TelemetryFeatures } from '../telemetry.types';

/**
 * Collects feature adoption flags for telemetry.
 * DB-dependent flags are resolved in parallel. Each flag is derived
 * independently so a single failure does not affect the others.
 *
 * Config-derived flags (`customFieldsInUse`, `scheduledTasks`) are read
 * from the already-collected `TelemetryConfig` to avoid duplicating
 * iteration logic that lives in `ConfigCollector`.
 */
@Injectable()
export class FeaturesCollector {
    constructor(private readonly connection: TransactionalConnection) {}

    async collect(config: TelemetryConfig): Promise<TelemetryFeatures> {
        const rawConnection = this.connection.rawConnection;
        const dbReady = rawConnection?.isInitialized;

        // Run all DB queries in parallel — they are independent
        const [multiChannel, sellerCount, multiStockLocation, apiKeysEnabled] = await Promise.all([
            this.safeCount(dbReady, Channel, count => count > 1),
            this.safeCount(dbReady, Seller, count => count),
            this.safeCount(dbReady, StockLocation, count => count > 1),
            this.safeCount(dbReady, ApiKey, count => count > 0),
        ]);

        return {
            multiChannel,
            multiVendor: this.deriveMultiVendor(sellerCount, dbReady, config),
            multiStockLocation,
            apiKeysEnabled,
            // Derived from already-collected config — no duplicate iteration
            customFieldsInUse: (config.customFieldsCount ?? 0) > 0,
            scheduledTasks: (config.scheduledTaskCount ?? 0) > 0,
        };
    }

    /**
     * Derives multiVendor from seller count + strategy name.
     * When DB is unavailable, returns `undefined` to stay consistent
     * with other DB-dependent flags — the strategy check alone is
     * not authoritative enough to report a definitive value.
     */
    private deriveMultiVendor(
        sellerCount: number | undefined,
        dbReady: boolean | undefined,
        config: TelemetryConfig,
    ): boolean | undefined {
        try {
            if (!dbReady) return undefined;
            const multipleSellers = sellerCount !== undefined && sellerCount > 1;
            const strategyName = config.orderSellerStrategy ?? 'unknown';
            const customStrategy =
                strategyName !== 'DefaultOrderSellerStrategy' && strategyName !== 'unknown';
            return multipleSellers || customStrategy;
        } catch {
            return undefined;
        }
    }

    // eslint-disable-next-line @typescript-eslint/ban-types
    private async safeCount<T>(
        dbReady: boolean | undefined,
        entity: Function,
        map: (count: number) => T,
    ): Promise<T | undefined> {
        try {
            if (!dbReady) return undefined;
            const count = await this.connection.rawConnection.getRepository(entity).count();
            return map(count);
        } catch {
            return undefined;
        }
    }
}
