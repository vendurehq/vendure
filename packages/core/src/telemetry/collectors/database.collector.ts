import { Injectable } from '@nestjs/common';
import { OrderType } from '@vendure/common/lib/generated-types';
import { IsNull, MoreThanOrEqual, Not, type Repository } from 'typeorm';

import { ConfigService } from '../../config/config.service';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Channel } from '../../entity/channel/channel.entity';
import { coreEntitiesMap } from '../../entity/entities';
import { Order } from '../../entity/order/order.entity';
import { toRangeBucket } from '../helpers/range-bucket.helper';
import {
    RangeBucket,
    SupportedDatabaseType,
    TelemetryEntityMetrics,
    TelemetryI18nMetrics,
    TelemetryOrderMetrics,
} from '../telemetry.types';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
// The daily heartbeat runs the entity-count sweep against a live production DB.
// Counting in bounded chunks (rather than one large Promise.all over ~50
// entities) avoids saturating the connection pool.
const ENTITY_COUNT_CHUNK_SIZE = 10;

export interface DatabaseInfo {
    databaseType: SupportedDatabaseType;
    metrics: TelemetryEntityMetrics;
}

export interface DatabaseCollectionOptions {
    /**
     * Order lifecycle metrics require several filtered counts on the Order table.
     * Keep them opt-in so startup telemetry and other callers avoid those scans.
     */
    includeOrderMetrics?: boolean;
}

interface EntityMetricsCollection {
    metrics: TelemetryEntityMetrics;
    orderCountAvailable: boolean;
}

/**
 * Collects database type and entity metrics for telemetry.
 */
@Injectable()
export class DatabaseCollector {
    constructor(
        private readonly configService: ConfigService,
        private readonly connection: TransactionalConnection,
    ) {}

    async collect(options: DatabaseCollectionOptions = {}): Promise<DatabaseInfo> {
        const databaseType = this.getDatabaseType();
        let metrics: TelemetryEntityMetrics;
        let orderCountAvailable = false;

        try {
            const collected = await this.collectEntityMetrics();
            metrics = collected.metrics;
            orderCountAvailable = collected.orderCountAvailable;
        } catch {
            metrics = { entities: {}, custom: { entityCount: 0 } };
        }

        // Order metrics are heartbeat-only and are skipped for large Order tables.
        // The filtered active/state/type counts are not indexed, so this protects
        // startup and high-volume installations from expensive full-table scans.
        const shouldCollectOrderMetrics =
            options.includeOrderMetrics === true && orderCountAvailable && metrics.entities.Order !== '100k+';
        const orders = shouldCollectOrderMetrics ? await this.collectOrderMetrics() : undefined;
        // Keep DB work sequential to minimize peak load from telemetry collection.
        const i18n = await this.collectI18nMetrics();
        if (orders) {
            metrics.orders = orders;
        }
        if (i18n) {
            metrics.i18n = i18n;
        }

        return {
            databaseType,
            metrics,
        };
    }

    /**
     * Collects order lifecycle metrics. Each field is resolved independently;
     * any query failure leaves that field undefined and never throws. Returns
     * undefined when no field could be resolved.
     */
    private async collectOrderMetrics(): Promise<TelemetryOrderMetrics | undefined> {
        try {
            const rawConnection = this.connection.rawConnection;
            if (!rawConnection?.isInitialized) {
                return undefined;
            }
            const repo = rawConnection.getRepository(Order);
            const since = new Date(Date.now() - THIRTY_DAYS_MS);

            // Run one query at a time to avoid stacking several counts against the
            // largest table in a production shop.
            const placed = await this.safeBucket(() =>
                repo.count({ where: { orderPlacedAt: Not(IsNull()) } }),
            );
            const active = await this.safeBucket(() => repo.count({ where: { active: true } }));
            const draft = await this.safeBucket(() => repo.count({ where: { state: 'Draft' } }));
            const placedLast30d = await this.safeBucket(() =>
                repo.count({ where: { orderPlacedAt: MoreThanOrEqual(since) } }),
            );
            const byType = await this.collectOrdersByType(repo);

            const orders: TelemetryOrderMetrics = {};
            if (placed) orders.placed = placed;
            if (active) orders.active = active;
            if (draft) orders.draft = draft;
            if (placedLast30d) orders.placedLast30d = placedLast30d;
            if (byType) orders.byType = byType;

            return Object.keys(orders).length > 0 ? orders : undefined;
        } catch {
            return undefined;
        }
    }

    private async collectOrdersByType(
        repo: Repository<Order>,
    ): Promise<Record<string, RangeBucket> | undefined> {
        try {
            const rows = await repo
                .createQueryBuilder('o')
                .select('o.type', 'type')
                .addSelect('COUNT(*)', 'count')
                .groupBy('o.type')
                .getRawMany<{ type: string; count: string | number }>();
            // Order.type is a plain varchar column, so allowlist against the
            // known OrderType enum values — never emit arbitrary strings that a
            // plugin or manual data fix might have written into the column.
            const allowedTypes = new Set<string>(Object.values(OrderType));
            const result: Record<string, RangeBucket> = {};
            for (const row of rows) {
                const type = String(row.type);
                const count = Number(row.count);
                if (allowedTypes.has(type) && count > 0) {
                    result[type] = toRangeBucket(count);
                }
            }
            return Object.keys(result).length > 0 ? result : undefined;
        } catch {
            return undefined;
        }
    }

    /**
     * Collects internationalization breadth from the Channel table: the number
     * of distinct language and currency codes across all channels (union of the
     * default code and the available* simple-array columns).
     */
    private async collectI18nMetrics(): Promise<TelemetryI18nMetrics | undefined> {
        try {
            const rawConnection = this.connection.rawConnection;
            if (!rawConnection?.isInitialized) {
                return undefined;
            }
            const channels = await rawConnection.getRepository(Channel).find({
                select: [
                    'defaultLanguageCode',
                    'availableLanguageCodes',
                    'defaultCurrencyCode',
                    'availableCurrencyCodes',
                ],
            });
            const languages = new Set<string>();
            const currencies = new Set<string>();
            for (const channel of channels) {
                if (channel.defaultLanguageCode) {
                    languages.add(channel.defaultLanguageCode);
                }
                for (const code of channel.availableLanguageCodes ?? []) {
                    languages.add(code);
                }
                if (channel.defaultCurrencyCode) {
                    currencies.add(channel.defaultCurrencyCode);
                }
                for (const code of channel.availableCurrencyCodes ?? []) {
                    currencies.add(code);
                }
            }
            return { languages: languages.size, currencies: currencies.size };
        } catch {
            return undefined;
        }
    }

    private async safeBucket(count: () => Promise<number>): Promise<RangeBucket | undefined> {
        try {
            return toRangeBucket(await count());
        } catch {
            return undefined;
        }
    }

    private getDatabaseType(): SupportedDatabaseType {
        const dbType = this.configService.dbConnectionOptions.type;
        if (dbType === 'better-sqlite3' || dbType === 'sqlite') {
            return 'sqlite';
        }
        if (dbType === 'postgres' || dbType === 'mysql' || dbType === 'mariadb') {
            return dbType;
        }
        return 'other';
    }

    private async collectEntityMetrics(): Promise<EntityMetricsCollection> {
        // Check if connection is ready before attempting to collect metrics
        const rawConnection = this.connection.rawConnection;
        if (!rawConnection?.isInitialized) {
            return {
                metrics: { entities: {}, custom: { entityCount: 0 } },
                orderCountAvailable: false,
            };
        }

        const coreEntityEntries = Object.entries(coreEntitiesMap);
        const counts = await this.countInChunks(coreEntityEntries.map(([, entity]) => entity));
        const orderIndex = coreEntityEntries.findIndex(([name]) => name === 'Order');

        const entities: Partial<Record<string, RangeBucket>> = {};
        coreEntityEntries.forEach(([name], index) => {
            const count = counts[index];
            if (count !== undefined) {
                entities[name] = toRangeBucket(count);
            }
        });

        const customEntities = this.getCustomEntities();
        const customEntityCount = customEntities.length;

        // Only count custom entity records if there are custom entities
        let totalCustomRecords: number | undefined;
        if (customEntityCount > 0) {
            const customCounts = await this.countInChunks(customEntities);
            if (customCounts.every((count): count is number => count !== undefined)) {
                totalCustomRecords = customCounts.reduce((sum, count) => sum + count, 0);
            }
        }

        return {
            metrics: {
                entities,
                custom: {
                    entityCount: customEntityCount,
                    ...(totalCustomRecords !== undefined && {
                        totalRecords: toRangeBucket(totalCustomRecords),
                    }),
                },
            },
            orderCountAvailable: orderIndex !== -1 && counts[orderIndex] !== undefined,
        };
    }

    /**
     * Counts a list of entities in bounded chunks to avoid saturating the
     * connection pool during the daily heartbeat sweep.
     */
    // eslint-disable-next-line @typescript-eslint/ban-types
    private async countInChunks(entities: Function[]): Promise<Array<number | undefined>> {
        const counts: Array<number | undefined> = [];
        for (let i = 0; i < entities.length; i += ENTITY_COUNT_CHUNK_SIZE) {
            const chunk = entities.slice(i, i + ENTITY_COUNT_CHUNK_SIZE);
            counts.push(...(await Promise.all(chunk.map(entity => this.safeCount(entity)))));
        }
        return counts;
    }

    // eslint-disable-next-line @typescript-eslint/ban-types
    private async safeCount(entity: Function): Promise<number | undefined> {
        try {
            const rawConnection = this.connection.rawConnection;
            if (!rawConnection?.isInitialized) {
                return undefined;
            }
            return await rawConnection.getRepository(entity).count();
        } catch {
            return undefined;
        }
    }

    // eslint-disable-next-line @typescript-eslint/ban-types
    private getCustomEntities(): Function[] {
        const entities = this.configService.dbConnectionOptions.entities;
        if (!Array.isArray(entities)) {
            return [];
        }

        const coreEntityNames = new Set(Object.keys(coreEntitiesMap));
        // eslint-disable-next-line @typescript-eslint/ban-types
        const customEntities: Function[] = [];

        for (const entity of entities) {
            if (typeof entity === 'function') {
                const entityName = entity.name;
                if (!coreEntityNames.has(entityName)) {
                    customEntities.push(entity);
                }
            }
        }

        return customEntities;
    }
}
