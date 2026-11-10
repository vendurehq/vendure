import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ID, Type } from '@vendure/common/lib/shared-types';
import { EntityMetadata, In } from 'typeorm';

import { RequestContext } from '../../../api/common/request-context';
import { RequestContextCacheService } from '../../../cache/request-context-cache.service';
import { InternalServerError } from '../../../common/error/errors';
import { findOptionsArrayToObject } from '../../../connection/find-options-array-to-object';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { ChannelAssignment } from '../../../entity/channel-assignment/channel-assignment';

/**
 * Describes how a ChannelAware entity's channel assignment rows are stored.
 */
export interface ChannelAssignmentMetadata {
    /** The channel assignment entity, e.g. `ProductChannel` */
    target: Type<ChannelAssignment>;
    /** The property holding the owning entity's id, e.g. `productId` */
    entityIdProperty: string;
    /**
     * The top-level properties holding per-channel data, e.g. `['enabled']`. Columns in an
     * embedded (such as `customFields`) are grouped under the embedded's property.
     */
    dataProperties: string[];
    /** Relation paths inside the data properties, e.g. `['customFields.featuredAsset']` */
    dataRelations: string[];
}

type AnyEntity = Type<any>;

/**
 * @description
 * Reads and writes the channel assignment rows of {@link ChannelAware} entities: one row per
 * (entity, Channel), holding the data which belongs to the entity in that Channel. See
 * {@link ChannelAssignment}.
 *
 * This service is generic: it works for any ChannelAware entity whose `channels` junction table is
 * owned by a channel assignment entity, and finds that entity from the TypeORM metadata.
 *
 * Reads of a single row made during one request are batched into one query per entity type and
 * Channel, so GraphQL field resolvers can read per-channel data without N+1 queries.
 *
 * @docsCategory services
 * @since 4.0.0
 */
@Injectable()
export class ChannelAssignmentService implements OnApplicationBootstrap {
    private metadataCache = new Map<AnyEntity, ChannelAssignmentMetadata | null>();

    constructor(
        private connection: TransactionalConnection,
        private requestContextCache: RequestContextCacheService,
    ) {}

    /**
     * Fails fast if a channel assignment entity and its junction table don't match. See
     * {@link validateChannelAssignmentMetadata}.
     */
    onApplicationBootstrap() {
        validateChannelAssignmentMetadata(this.connection.rawConnection.entityMetadatas);
    }

    /**
     * @description
     * Returns how the channel assignment rows of the given entity type are stored, or `undefined` if
     * the entity has no channel assignment entity.
     */
    getMetadata(entityType: AnyEntity): ChannelAssignmentMetadata | undefined {
        if (!this.metadataCache.has(entityType)) {
            this.metadataCache.set(entityType, this.resolveMetadata(entityType) ?? null);
        }
        return this.metadataCache.get(entityType) ?? undefined;
    }

    /**
     * @description
     * Returns the assignment row of the entity in the given Channel (defaults to the active
     * Channel), or `undefined` if the entity is not assigned to that Channel. Batched per request.
     */
    getAssignment<T extends ChannelAssignment>(
        ctx: RequestContext,
        entityType: AnyEntity,
        entityId: ID,
        channelId: ID = ctx.channelId,
    ): Promise<T | undefined> {
        const batch = this.getBatch(ctx, entityType, channelId);
        const key = String(entityId);
        let promise = batch.pending.get(key);
        if (!promise) {
            promise = new Promise((resolve, reject) => batch.queue.push({ id: key, resolve, reject }));
            batch.pending.set(key, promise);
            if (!batch.scheduled) {
                batch.scheduled = true;
                process.nextTick(() => this.flush(ctx, entityType, channelId, batch));
            }
        }
        return promise as Promise<T | undefined>;
    }

    /**
     * @description
     * Returns the assignment rows of the given entities in one Channel, keyed by entity id.
     */
    async getAssignments<T extends ChannelAssignment>(
        ctx: RequestContext,
        entityType: AnyEntity,
        entityIds: ID[],
        channelId: ID = ctx.channelId,
    ): Promise<Map<string, T>> {
        const meta = this.getMetadataOrThrow(entityType);
        if (!entityIds.length) {
            return new Map();
        }
        const rows = await this.connection.getRepository(ctx, meta.target).find({
            where: { [meta.entityIdProperty]: In(entityIds), channelId },
        });
        return new Map(rows.map((row: any) => [String(row[meta.entityIdProperty]), row as T]));
    }

    /**
     * @description
     * Returns the assignment rows of the given entities in every Channel they are assigned to,
     * keyed by entity id and then Channel id. Used e.g. by search indexers.
     */
    async getAssignmentsByChannel<T extends ChannelAssignment>(
        ctx: RequestContext,
        entityType: AnyEntity,
        entityIds: ID[],
    ): Promise<Map<string, Map<string, T>>> {
        const meta = this.getMetadataOrThrow(entityType);
        const result = new Map<string, Map<string, T>>();
        if (!entityIds.length) {
            return result;
        }
        const rows = await this.connection.getRepository(ctx, meta.target).find({
            where: { [meta.entityIdProperty]: In(entityIds) },
        });
        for (const row of rows as any[]) {
            const key = String(row[meta.entityIdProperty]);
            const byChannel = result.get(key) ?? new Map<string, T>();
            byChannel.set(String(row.channelId), row);
            result.set(key, byChannel);
        }
        return result;
    }

    /**
     * @description
     * Updates the data columns of existing assignment rows. Never assigns an entity to a Channel.
     */
    async update<T extends ChannelAssignment>(
        ctx: RequestContext,
        entityType: AnyEntity,
        entityIds: ID[],
        channelIds: ID[],
        values: Partial<Omit<T, 'channelId' | 'channel'>>,
    ): Promise<void> {
        const meta = this.getMetadataOrThrow(entityType);
        this.assertDataProperties(meta, values);
        if (!entityIds.length || !channelIds.length || !Object.keys(values).length) {
            return;
        }
        await this.connection
            .getRepository(ctx, meta.target)
            .update({ [meta.entityIdProperty]: In(entityIds), channelId: In(channelIds) }, values);
        this.requestContextCache.set(ctx, this.cacheKey(entityType), undefined);
    }

    /**
     * @description
     * Copies the data columns of the entity's assignment row in `fromChannelId` to its rows in
     * `toChannelIds`. Called by `ChannelService.assignToChannels()` so that an entity newly assigned
     * to a Channel starts with the data it has in the Channel it was assigned from.
     */
    async copyAssignment(
        ctx: RequestContext,
        entityType: AnyEntity,
        entityId: ID,
        fromChannelId: ID,
        toChannelIds: ID[],
    ): Promise<void> {
        const meta = this.getMetadata(entityType);
        if (!meta || !meta.dataProperties.length || !toChannelIds.length) {
            return;
        }
        const repo = this.connection.getRepository(ctx, meta.target);
        const where = (channelId: ID | ReturnType<typeof In>) =>
            ({ [meta.entityIdProperty]: entityId, channelId }) as any;
        const source = await repo.findOne({
            where: where(fromChannelId),
            relations: findOptionsArrayToObject(meta.dataRelations),
        });
        if (!source) {
            return;
        }
        const targets = await repo.find({
            where: where(In(toChannelIds)),
            relations: findOptionsArrayToObject(meta.dataRelations),
        });
        for (const target of targets) {
            for (const property of meta.dataProperties) {
                (target as any)[property] = (source as any)[property];
            }
        }
        await repo.save(targets, { reload: false });
        this.requestContextCache.set(ctx, this.cacheKey(entityType), undefined);
    }

    /**
     * Only the per-channel data properties may be written. The key columns (entity id, Channel id)
     * define the assignment itself and are changed via `ChannelService.assignToChannels()` /
     * `removeFromChannels()`.
     */
    private assertDataProperties(meta: ChannelAssignmentMetadata, values: object) {
        const invalid = Object.keys(values).filter(key => !meta.dataProperties.includes(key));
        if (invalid.length) {
            throw new InternalServerError(
                `Cannot write ${invalid.map(k => `"${k}"`).join(', ')} on ${meta.target.name}. ` +
                    `Writable per-channel properties: ${meta.dataProperties.map(k => `"${k}"`).join(', ') || 'none'}`,
            );
        }
    }

    private getMetadataOrThrow(entityType: AnyEntity): ChannelAssignmentMetadata {
        const meta = this.getMetadata(entityType);
        if (!meta) {
            throw new InternalServerError(`${entityType.name} has no channel assignment entity`);
        }
        return meta;
    }

    private resolveMetadata(entityType: AnyEntity): ChannelAssignmentMetadata | undefined {
        const dataSource = this.connection.rawConnection;
        if (!dataSource.hasMetadata(entityType)) {
            return;
        }
        const junction = dataSource
            .getMetadata(entityType)
            .findRelationWithPropertyPath('channels')?.junctionEntityMetadata;
        const assignment = junction && this.findAssignmentMetadata(junction.tableName);
        if (!junction || !assignment) {
            return;
        }
        const dataProperties = new Set<string>();
        for (const column of assignment.columns) {
            if (column.isPrimary) {
                continue;
            }
            if (column.embeddedMetadata) {
                dataProperties.add(column.embeddedMetadata.propertyName);
            } else if (!column.relationMetadata) {
                dataProperties.add(column.propertyName);
            }
        }
        return {
            target: assignment.target as Type<ChannelAssignment>,
            entityIdProperty: junction.ownerColumns[0].propertyName,
            dataProperties: Array.from(dataProperties),
            dataRelations: assignment.relations.filter(r => r.embeddedMetadata).map(r => r.propertyPath),
        };
    }

    private findAssignmentMetadata(tableName: string): EntityMetadata | undefined {
        return findAssignmentMetadata(this.connection.rawConnection.entityMetadatas, tableName);
    }

    private cacheKey(entityType: AnyEntity) {
        return `ChannelAssignmentService.${entityType.name}`;
    }

    private getBatch(ctx: RequestContext, entityType: AnyEntity, channelId: ID): Batch {
        const byChannel = this.requestContextCache.get(
            ctx,
            this.cacheKey(entityType),
            () => new Map(),
        ) as Map<string, Batch>;
        let batch = byChannel.get(String(channelId));
        if (!batch) {
            batch = { pending: new Map(), queue: [], scheduled: false };
            byChannel.set(String(channelId), batch);
        }
        return batch;
    }

    private async flush(ctx: RequestContext, entityType: AnyEntity, channelId: ID, batch: Batch) {
        const queue = batch.queue;
        batch.queue = [];
        batch.scheduled = false;
        try {
            const rows = await this.getAssignments(
                ctx,
                entityType,
                queue.map(q => q.id),
                channelId,
            );
            queue.forEach(item => item.resolve(rows.get(item.id)));
        } catch (e: any) {
            queue.forEach(item => item.reject(e));
        }
    }
}

interface Batch {
    pending: Map<string, Promise<ChannelAssignment | undefined>>;
    queue: Array<{ id: string; resolve: (v: any) => void; reject: (e: any) => void }>;
    scheduled: boolean;
}

function findAssignmentMetadata(
    entityMetadatas: EntityMetadata[],
    tableName: string,
): EntityMetadata | undefined {
    return entityMetadatas.find(m => m.tableName === tableName && m.tableType !== 'junction');
}

/**
 * @description
 * Checks that every channel assignment entity matches the `channels` junction table it sits on,
 * in both directions:
 *
 * - a junction table which TypeORM does not synchronize (`JoinTable({ synchronize: false })`) must
 *   be owned by an assignment entity with the same key columns, otherwise the table would not be
 *   created, or would be created differently (e.g. under a custom naming strategy);
 * - an assignment entity on a junction table which TypeORM *does* synchronize is rejected, because
 *   every schema sync would rebuild the table from the many-to-many relation and drop the
 *   per-channel columns.
 *
 * Exported for testing.
 */
export function validateChannelAssignmentMetadata(entityMetadatas: EntityMetadata[]) {
    for (const metadata of entityMetadatas) {
        const relation = metadata.findRelationWithPropertyPath('channels');
        const junction = relation?.junctionEntityMetadata;
        if (!relation?.isOwning || !junction) {
            continue;
        }
        const assignment = findAssignmentMetadata(entityMetadatas, junction.tableName);
        if (junction.synchronize !== false) {
            if (assignment) {
                throw new InternalServerError(
                    `${assignment.name} is a channel assignment entity on the "${junction.tableName}" table, ` +
                        `so the "channels" relation of ${metadata.name} must use ` +
                        '`@JoinTable({ synchronize: false })`. Otherwise schema sync drops its per-channel columns.',
                );
            }
            continue;
        }
        const expected = junction.columns.map(c => c.databaseName).sort();
        const actual = assignment?.primaryColumns.map(c => c.databaseName).sort();
        if (!assignment || JSON.stringify(expected) !== JSON.stringify(actual)) {
            throw new InternalServerError(
                `The "channels" junction table "${junction.tableName}" of ${metadata.name} must be owned ` +
                    `by a channel assignment entity with the primary columns ${expected.join(', ')}` +
                    (actual ? `, found ${actual.join(', ')}` : ''),
            );
        }
    }
}
