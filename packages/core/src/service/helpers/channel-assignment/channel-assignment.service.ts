import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ID, Type } from '@vendure/common/lib/shared-types';
import { EntityMetadata, In } from 'typeorm';
import type { ChannelAssignment } from '../../../entity/channel-assignment/channel-assignment';

import { RequestContext } from '../../../api/common/request-context';
import { RequestContextCacheService } from '../../../cache/request-context-cache.service';
import { InternalServerError } from '../../../common/error/errors';
import { idsAreEqual } from '../../../common/utils';
import { Logger } from '../../../config/logger/vendure-logger';
import { findOptionsArrayToObject } from '../../../connection/find-options-array-to-object';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import {
    ChannelAssignmentEntityOptions,
    getChannelAssignmentEntities,
} from '../../../entity/channel-assignment/channel-assignment-registry';

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
 * The property under which the ListQueryBuilder loads the assignment row of the Channel a list is
 * scoped to (the `loadChannelAssignment` option). Not a column, nor part of the GraphQL schema.
 *
 * @internal
 */
export const LOADED_CHANNEL_ASSIGNMENT_PROPERTY = 'lqb__channelAssignment';

/**
 * @description
 * Reads and writes the channel assignment rows of {@link ChannelAware} entities: one row per
 * (entity, Channel), holding the data which belongs to the entity in that Channel. See
 * {@link ChannelAssignment}.
 *
 * This service is generic: it works for any ChannelAware entity which has a channel assignment
 * entity declared with {@link ChannelAssignmentEntity}.
 *
 * Reads of single rows made in the same tick are batched into one query per entity type and
 * Channel, so GraphQL field resolvers can read per-channel data without N+1 queries. Results are
 * not cached, so a read always sees the current rows.
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
     * Channel), or `undefined` if the entity is not assigned to that Channel. Calls made in the
     * same tick are batched into one query.
     *
     * If an entity is passed which was loaded by a ListQueryBuilder list with the
     * `loadChannelAssignment` option, scoped to the same Channel, the row loaded with it is
     * returned without a query.
     */
    getAssignment<T extends ChannelAssignment>(
        ctx: RequestContext,
        entityType: AnyEntity,
        entityOrId: ID | { id: ID },
        channelId: ID = ctx.channelId,
    ): Promise<T | undefined> {
        if (typeof entityOrId === 'object') {
            const loaded = this.getLoadedAssignment<T>(entityOrId, channelId);
            if (loaded) {
                return Promise.resolve(loaded);
            }
        }
        const entityId = typeof entityOrId === 'object' ? entityOrId.id : entityOrId;
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
     * Throws if `values` contains anything but per-channel data properties (see
     * {@link assertWritable}).
     */
    async update<T extends ChannelAssignment>(
        ctx: RequestContext,
        entityType: AnyEntity,
        entityIds: ID[],
        channelIds: ID[],
        values: Partial<Omit<T, 'channelId' | 'channel'>>,
    ): Promise<void> {
        const meta = this.assertWritable(entityType, values);
        if (!entityIds.length || !channelIds.length || !Object.keys(values).length) {
            return;
        }
        await this.connection
            .getRepository(ctx, meta.target)
            .update({ [meta.entityIdProperty]: In(entityIds), channelId: In(channelIds) }, values);
    }

    /**
     * @description
     * Throws unless every key of `values` is a per-channel data property of the entity's channel
     * assignment entity. The key columns (entity id, Channel id) define the assignment itself and
     * are changed via `ChannelService.assignToChannels()` / `removeFromChannels()`.
     */
    assertWritable(entityType: AnyEntity, values: object): ChannelAssignmentMetadata {
        const meta = this.getMetadataOrThrow(entityType);
        const invalid = Object.keys(values).filter(key => !meta.dataProperties.includes(key));
        if (invalid.length) {
            throw new InternalServerError(
                `Cannot write ${invalid.map(k => `"${k}"`).join(', ')} on ${meta.target.name}. ` +
                    `Writable per-channel properties: ${meta.dataProperties.map(k => `"${k}"`).join(', ') || 'none'}`,
            );
        }
        return meta;
    }

    /**
     * @description
     * Copies the data columns of the entity's assignment row in `fromChannelId` to its rows in
     * `toChannelIds`. Called by `ChannelService.assignToChannels()` so that an entity newly assigned
     * to a Channel starts with the data it has in a Channel it was already assigned to.
     */
    async copyAssignment(
        ctx: RequestContext,
        entityType: AnyEntity,
        entityId: ID,
        fromChannelId: ID,
        toChannelIds: ID[],
    ): Promise<void> {
        const meta = this.getMetadata(entityType);
        const targetChannelIds = toChannelIds.filter(id => String(id) !== String(fromChannelId));
        if (!meta || !meta.dataProperties.length || !targetChannelIds.length) {
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
            Logger.debug(
                `${entityType.name} ${String(entityId)} has no assignment in Channel ${String(fromChannelId)} to copy from`,
            );
            return;
        }
        const targets = await repo.find({
            where: where(In(targetChannelIds)),
            relations: findOptionsArrayToObject(meta.dataRelations),
        });
        for (const target of targets) {
            for (const property of meta.dataProperties) {
                (target as any)[property] = (source as any)[property];
            }
        }
        await repo.save(targets, { reload: false });
    }

    /**
     * @description
     * Like {@link ChannelAssignmentService.getMetadata}, but throws if the entity has no channel
     * assignment entity.
     */
    getMetadataOrThrow(entityType: AnyEntity): ChannelAssignmentMetadata {
        const meta = this.getMetadata(entityType);
        if (!meta) {
            throw new InternalServerError(`${entityType.name} has no channel assignment entity`);
        }
        return meta;
    }

    private resolveMetadata(entityType: AnyEntity): ChannelAssignmentMetadata | undefined {
        const found = findChannelAssignmentEntity(this.connection.rawConnection.entityMetadatas, entityType);
        if (!found) {
            return;
        }
        const { metadata: assignment, options } = found;
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
            entityIdProperty: `${options.entityProperty}Id`,
            dataProperties: Array.from(dataProperties),
            dataRelations: assignment.relations.filter(r => r.embeddedMetadata).map(r => r.propertyPath),
        };
    }

    /**
     * @description
     * Returns the assignment row loaded onto the entity by a ListQueryBuilder list with the
     * `loadChannelAssignment` option, if it is the row of the given Channel.
     */
    getLoadedAssignment<T extends ChannelAssignment>(entity: object, channelId: ID): T | undefined {
        const loaded: T | undefined = (entity as any)[LOADED_CHANNEL_ASSIGNMENT_PROPERTY];
        return loaded && idsAreEqual(loaded.channelId, channelId) ? loaded : undefined;
    }

    private getBatch(ctx: RequestContext, entityType: AnyEntity, channelId: ID): Batch {
        const byChannel = this.requestContextCache.get(
            ctx,
            `ChannelAssignmentService.${entityType.name}`,
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
        // Only reads which are still pending are shared, so a later read sees the current rows
        for (const item of queue) {
            batch.pending.delete(item.id);
        }
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

/**
 * @description
 * Finds the channel assignment entity of `entityType` among the registered
 * {@link ChannelAssignmentEntity} declarations, if it is part of the given entity metadata.
 */
export function findChannelAssignmentEntity(
    entityMetadatas: EntityMetadata[],
    entityType: unknown,
    registry: Map<Type<any>, ChannelAssignmentEntityOptions> = getChannelAssignmentEntities(),
): { metadata: EntityMetadata; options: ChannelAssignmentEntityOptions } | undefined {
    for (const [target, options] of registry) {
        if (options.entity() !== entityType) {
            continue;
        }
        const metadata = entityMetadatas.find(m => m.target === target);
        if (metadata) {
            return { metadata, options };
        }
    }
}

/**
 * @description
 * Checks that every channel assignment entity matches the `channels` junction table it sits on:
 *
 * - a junction table which TypeORM does not synchronize (`JoinTable({ synchronize: false })`) must
 *   have an assignment entity on the same table with the same key columns, otherwise the table
 *   would not be created, or would be created differently (e.g. under a custom naming strategy);
 * - an assignment entity, or any other entity, on a junction table which TypeORM *does*
 *   synchronize is rejected, because every schema sync would rebuild the table from the
 *   many-to-many relation and drop the extra columns;
 * - relations declared directly on an assignment entity are rejected, because they are not
 *   copied on assign nor available to list filters. Relations in its `customFields` are supported.
 *
 * Exported for testing.
 */
export function validateChannelAssignmentMetadata(
    entityMetadatas: EntityMetadata[],
    registry: Map<Type<any>, ChannelAssignmentEntityOptions> = getChannelAssignmentEntities(),
) {
    for (const metadata of entityMetadatas) {
        const relation = metadata.findRelationWithPropertyPath('channels');
        const junction = relation?.junctionEntityMetadata;
        if (!relation?.isOwning || !junction) {
            continue;
        }
        const assignment = findChannelAssignmentEntity(entityMetadatas, metadata.target, registry)?.metadata;
        const onSameTable = entityMetadatas.find(
            m => m.tableName === junction.tableName && m.tableType !== 'junction',
        );
        if (junction.synchronize !== false) {
            if (assignment || onSameTable) {
                throw new InternalServerError(
                    `${(assignment ?? onSameTable)?.name ?? ''} maps the "${junction.tableName}" table, so the ` +
                        `"channels" relation of ${metadata.name} must use \`@JoinTable({ synchronize: false })\`. ` +
                        'Otherwise schema sync drops its extra columns.',
                );
            }
            continue;
        }
        const expected = junction.columns.map(c => c.databaseName).sort();
        const actual = assignment?.primaryColumns.map(c => c.databaseName).sort();
        if (
            !assignment ||
            assignment.tableName !== junction.tableName ||
            JSON.stringify(expected) !== JSON.stringify(actual)
        ) {
            throw new InternalServerError(
                `The "channels" junction table "${junction.tableName}" of ${metadata.name} must be owned ` +
                    `by a channel assignment entity declared with @ChannelAssignmentEntity, with the primary columns ${expected.join(', ')}` +
                    (assignment ? `; found "${assignment.tableName}" with ${actual?.join(', ') ?? ''}` : ''),
            );
        }
        const keyRelations = assignment.relations.filter(r => r.joinColumns.some(c => c.isPrimary));
        const unsupported = assignment.relations.filter(
            r => !r.embeddedMetadata && !keyRelations.includes(r),
        );
        if (unsupported.length) {
            throw new InternalServerError(
                `${assignment.name} declares the relation(s) ${unsupported.map(r => `"${r.propertyName}"`).join(', ')}. ` +
                    'Relations on a channel assignment entity are only supported as custom fields.',
            );
        }
    }
}
