import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
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
import {
    ChannelCustomFieldsOptions,
    registerChannelCustomFieldsReader,
    unregisterChannelCustomFieldsReader,
} from '../../../entity/channel-assignment/channel-custom-fields';

/**
 * Describes how a ChannelAware entity's channel assignment rows are stored.
 */
export interface ChannelAssignmentMetadata {
    /** The channel assignment entity, e.g. `ProductChannel` */
    target: Type<ChannelAssignment>;
    /** The property holding the owning entity's id, e.g. `productId` */
    entityIdProperty: string;
    /** The ChannelAware entity, e.g. `Product` */
    entityType: Type<any>;
    /**
     * The top-level properties holding per-channel data, e.g. `['enabled']`. Columns in an
     * embedded (such as `customFields`) are grouped under the embedded's property.
     */
    dataProperties: string[];
    /** Relation paths inside the data properties, e.g. `['customFields.featuredAsset']` */
    dataRelations: string[];
    /**
     * The `unique` channel-scoped custom fields, e.g. `['channelSku']`. They are unique within each
     * Channel, so they are not copied to a newly assigned Channel.
     */
    uniqueCustomFields: string[];
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
export class ChannelAssignmentService implements OnApplicationBootstrap, OnApplicationShutdown {
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
        // Serves `getChannelCustomFields()` on entities such as Product
        registerChannelCustomFieldsReader(this);
    }

    onApplicationShutdown() {
        unregisterChannelCustomFieldsReader(this);
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
     *
     * `unique` channel-scoped custom fields are not copied: the value may already be used by another
     * entity in the target Channel, so the target row keeps its own value (the column default).
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
            const ownCustomFields = (target as any).customFields;
            for (const property of meta.dataProperties) {
                (target as any)[property] = (source as any)[property];
            }
            if (meta.uniqueCustomFields.length && (source as any).customFields) {
                const customFields = { ...(source as any).customFields };
                for (const name of meta.uniqueCustomFields) {
                    customFields[name] = ownCustomFields?.[name] ?? null;
                }
                (target as any).customFields = customFields;
            }
        }
        await repo.save(targets, { reload: false });
    }

    /**
     * @description
     * Writes channel-scoped custom field values to the entity's assignment row in the given Channel.
     * Relation fields take the related entity (or `{ id }`), or `null`.
     */
    async updateCustomFields(
        ctx: RequestContext,
        entityType: AnyEntity,
        entityId: ID,
        channelId: ID,
        values: Record<string, unknown>,
    ): Promise<void> {
        if (!Object.keys(values).length) {
            return;
        }
        const meta = this.getMetadataOrThrow(entityType);
        const repo = this.connection.getRepository(ctx, meta.target);
        const row: any = await repo.findOne({
            where: { [meta.entityIdProperty]: entityId, channelId },
            relations: findOptionsArrayToObject(meta.dataRelations),
        });
        if (!row) {
            Logger.warn(
                `Channel-scoped custom fields of ${entityType.name} ${String(entityId)} were not saved, ` +
                    `because it is not assigned to Channel ${String(channelId)}`,
            );
            return;
        }
        row.customFields = { ...row.customFields, ...values };
        await repo.save(row, { reload: false });
    }

    /**
     * @description
     * Returns the values of the entity's channel-scoped custom fields in the active Channel. A field
     * is `null` if the entity is not assigned to the Channel or the value is not set. Relation fields
     * are resolved separately, by the GraphQL relation resolver.
     *
     * Like {@link ChannelAssignmentService.getAssignment}, if an entity is passed which a
     * ListQueryBuilder list loaded with the `loadChannelAssignment` option, its row is used without
     * a query.
     */
    async getCustomFieldValues(
        ctx: RequestContext,
        entityName: string,
        entityOrId: ID | { id: ID } | undefined,
        fieldNames: string[],
    ): Promise<Record<string, unknown>> {
        const meta = this.getMetadataByEntityName(entityName);
        const entityId = typeof entityOrId === 'object' ? entityOrId?.id : entityOrId;
        const values =
            meta && entityOrId != null && entityId != null
                ? await this.getChannelCustomFields(ctx, meta.entityType, entityOrId)
                : undefined;
        const result: Record<string, unknown> = {};
        for (const name of fieldNames) {
            result[name] = values?.[name] ?? null;
        }
        return result;
    }

    /**
     * @description
     * Returns the values of the entity's `channelScoped` custom fields in a Channel (the active
     * Channel by default), or `undefined` if the entity is not assigned to that Channel. Relation
     * fields are only set if they are listed in `options.relations`.
     *
     * Entities expose this as a typed method, e.g. `product.getChannelCustomFields(ctx)`.
     * Reads without relations are batched, and reuse a row loaded by a ListQueryBuilder list with
     * the `loadChannelAssignment` option.
     */
    async getChannelCustomFields(
        ctx: RequestContext,
        entityType: AnyEntity,
        entityOrId: ID | { id: ID },
        options: ChannelCustomFieldsOptions<any> = {},
    ): Promise<Record<string, unknown> | undefined> {
        const meta = this.getMetadataOrThrow(entityType);
        const channelId = options.channelId ?? ctx.channelId;
        const relations = (options.relations ?? []).map(name => `customFields.${name}`);
        const unknownRelations = relations.filter(path => !meta.dataRelations.includes(path));
        if (unknownRelations.length) {
            throw new InternalServerError(
                `${unknownRelations.map(p => `"${p}"`).join(', ')} of ${entityType.name} ` +
                    'is not a channel-scoped relation custom field',
            );
        }
        let row: any;
        if (!relations.length) {
            row = await this.getAssignment(ctx, entityType, entityOrId, channelId);
        } else {
            const entityId = typeof entityOrId === 'object' ? entityOrId.id : entityOrId;
            row = await this.connection.getRepository(ctx, meta.target).findOne({
                where: { [meta.entityIdProperty]: entityId, channelId },
                relations: findOptionsArrayToObject(relations),
            });
        }
        // A copy, so that changing it does not change a row loaded with a list
        return row ? { ...row.customFields } : undefined;
    }

    /**
     * @description
     * Returns the custom field values to give a copy of the entity, as `customFields` input of its
     * create method, e.g. in an {@link EntityDuplicator}: its ordinary custom fields, plus its
     * channel-scoped ones in the active Channel. `unique` channel-scoped fields are left out, since
     * the copy is created in the same Channel.
     *
     * @since 4.0.0
     */
    async getCustomFieldsToCopy(
        ctx: RequestContext,
        entityType: AnyEntity,
        entity: { id: ID; customFields?: object },
    ): Promise<Record<string, unknown>> {
        const meta = this.getMetadata(entityType);
        const channelValues = meta ? await this.getChannelCustomFields(ctx, entityType, entity) : undefined;
        // Spreading copies only own properties, not the getters of channel-scoped names
        const result: Record<string, unknown> = { ...entity.customFields, ...channelValues };
        for (const name of meta?.uniqueCustomFields ?? []) {
            delete result[name];
        }
        return result;
    }

    /**
     * @description
     * Like {@link ChannelAssignmentService.getMetadata}, looked up by entity name, e.g. `'Product'`.
     */
    getMetadataByEntityName(entityName: string): ChannelAssignmentMetadata | undefined {
        const dataSource = this.connection.rawConnection;
        return dataSource.hasMetadata(entityName)
            ? this.getMetadata(dataSource.getMetadata(entityName).target as AnyEntity)
            : undefined;
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
        // A many-to-many relation (a `list: true` relation custom field) has no column on the
        // assignment table, only a junction table, but is still part of its embedded.
        for (const relation of assignment.relations) {
            if (relation.embeddedMetadata) {
                dataProperties.add(relation.embeddedMetadata.propertyName);
            }
        }
        return {
            target: assignment.target as Type<ChannelAssignment>,
            entityType,
            entityIdProperty: `${options.entityProperty}Id`,
            dataProperties: Array.from(dataProperties),
            dataRelations: assignment.relations.filter(r => r.embeddedMetadata).map(r => r.propertyPath),
            uniqueCustomFields: assignment.indices
                .filter(index => index.isUnique)
                .flatMap(index => index.columns)
                .filter(column => column.embeddedMetadata?.propertyName === 'customFields')
                .map(column => column.propertyName),
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
