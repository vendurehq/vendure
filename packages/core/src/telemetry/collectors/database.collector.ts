import { Injectable } from '@nestjs/common';
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
    TelemetryOrderMetrics,
} from '../telemetry.types';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface DatabaseInfo {
    databaseType: SupportedDatabaseType;
    metrics: TelemetryEntityMetrics;
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

    async collect(): Promise<DatabaseInfo> {
        const databaseType = this.getDatabaseType();
        let metrics: TelemetryEntityMetrics;

        try {
            metrics = await this.collectEntityMetrics();
        } catch {
            metrics = { entities: {}, custom: { entityCount: 0 } };
        }

        // Order and i18n metrics are collected independently so that a failure
        // here never affects the already-collected entity metrics.
        const orders = await this.collectOrderMetrics();
        if (orders) {
            metrics.orders = orders;
        }
        const i18n = await this.collectI18nMetrics();
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
     * any query failure leaves that field undefined and never throws.
     */
    private async collectOrderMetrics(): Promise<TelemetryOrderMetrics | undefined> {
        try {
            const rawConnection = this.connection.rawConnection;
            if (!rawConnection?.isInitialized) {
                return undefined;
            }
            const repo = rawConnection.getRepository(Order);
            const orders: TelemetryOrderMetrics = {};

            const placed = await this.safeBucket(() =>
                repo.count({ where: { orderPlacedAt: Not(IsNull()) } }),
            );
            if (placed) orders.placed = placed;

            const active = await this.safeBucket(() => repo.count({ where: { active: true } }));
            if (active) orders.active = active;

            const draft = await this.safeBucket(() => repo.count({ where: { state: 'Draft' as any } }));
            if (draft) orders.draft = draft;

            const since = new Date(Date.now() - THIRTY_DAYS_MS);
            const placedLast30d = await this.safeBucket(() =>
                repo.count({ where: { orderPlacedAt: MoreThanOrEqual(since) } }),
            );
            if (placedLast30d) orders.placedLast30d = placedLast30d;

            const byType = await this.collectOrdersByType(repo);
            if (byType) orders.byType = byType;

            return orders;
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
            const result: Record<string, RangeBucket> = {};
            for (const row of rows) {
                const count = Number(row.count);
                if (row.type && count > 0) {
                    result[String(row.type)] = toRangeBucket(count);
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
    private async collectI18nMetrics(): Promise<TelemetryEntityMetrics['i18n'] | undefined> {
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

    private async collectEntityMetrics(): Promise<TelemetryEntityMetrics> {
        // Check if connection is ready before attempting to collect metrics
        const rawConnection = this.connection.rawConnection;
        if (!rawConnection?.isInitialized) {
            return { entities: {}, custom: { entityCount: 0 } };
        }

        const coreEntityEntries = Object.entries(coreEntitiesMap);
        const counts = await Promise.all(coreEntityEntries.map(([, entity]) => this.safeCount(entity)));

        const entities: Partial<Record<string, RangeBucket>> = {};
        coreEntityEntries.forEach(([name], index) => {
            entities[name] = toRangeBucket(counts[index]);
        });

        const customEntities = this.getCustomEntities();
        const customEntityCount = customEntities.length;

        // Only count custom entity records if there are custom entities
        let totalCustomRecords: number | undefined;
        if (customEntityCount > 0) {
            const customCounts = await Promise.all(customEntities.map(entity => this.safeCount(entity)));
            totalCustomRecords = customCounts.reduce((sum, count) => sum + count, 0);
        }

        return {
            entities,
            custom: {
                entityCount: customEntityCount,
                ...(totalCustomRecords !== undefined && { totalRecords: toRangeBucket(totalCustomRecords) }),
            },
        };
    }

    // eslint-disable-next-line @typescript-eslint/ban-types
    private async safeCount(entity: Function): Promise<number> {
        try {
            const rawConnection = this.connection.rawConnection;
            if (!rawConnection?.isInitialized) {
                return 0;
            }
            return await rawConnection.getRepository(entity).count();
        } catch {
            return 0;
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
