import { Injectable } from '@nestjs/common';

import { ConfigService } from '../../config/config.service';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { coreEntitiesMap } from '../../entity/entities';
import { toRangeBucket } from '../helpers/range-bucket.helper';
import { RangeBucket, SupportedDatabaseType, TelemetryEntityMetrics } from '../telemetry.types';

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

        return {
            databaseType,
            metrics,
        };
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
