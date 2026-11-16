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
import { VendureEntity } from '../../../entity/base/base.entity';
import {
    ChannelAssignmentEntityOptions,
    getChannelAssignmentEntities,
    LOADED_CHANNEL_ASSIGNMENT_PROPERTY,
} from '../../../entity/channel-assignment/channel-assignment-registry';
import {
    ChannelCustomFieldsOptions,
    registerChannelCustomFieldsStore,
    unregisterChannelCustomFieldsStore,
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

export { LOADED_CHANNEL_ASSIGNMENT_PROPERTY };

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
    private readonly metadataCache = new Map<AnyEntity, ChannelAssignmentMetadata | null>();
    private channelScopedFieldsByType?: Map<AnyEntity, ChannelScopedFields>;
    /**
     * The JSON of the channel-scoped values set on a `customFields` object when it was loaded, so that
     * persistChannelCustomFields() only writes values which have changed since.
     */
    private readonly loadedChannelValues = new WeakMap<object, Record<string, string>>();

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
        // Serves `getChannelCustomFields()` on entities such as Product, and the reads and writes of
        // channel-scoped custom fields by the TransactionalConnection
        registerChannelCustomFieldsStore(this);
    }

    onApplicationShutdown() {
        unregisterChannelCustomFieldsStore(this);
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
        requireChannelId(channelId);
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
        requireChannelId(channelId);
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
     * Returns the values of the entity's channel-scoped custom fields in a Channel (the active
     * Channel by default), or `undefined` if the entity is not assigned to that Channel. Relation
     * fields are only set if they are listed in `options.relations`.
     *
     * Entities expose this as a typed method, e.g. `product.getChannelCustomFields(ctx)`. An entity
     * loaded with a RequestContext already has the values of its Channel on `customFields`, so this
     * is for reading the values of another Channel (`options.channelId`), loading relation fields,
     * or reading the values of an entity loaded without a RequestContext.
     *
     * Reads without relations made in the same tick are batched into one query, and reuse the row
     * loaded with the entity, if any.
     */
    async getChannelCustomFields(
        ctx: RequestContext,
        entityType: AnyEntity,
        entityOrId: ID | { id: ID },
        options: ChannelCustomFieldsOptions<any> = {},
    ): Promise<Record<string, unknown> | undefined> {
        const meta = this.getMetadataOrThrow(entityType);
        const channelId = requireChannelId(options.channelId ?? ctx.channelId);
        const relations = (options.relations ?? []).map(name => `customFields.${name}`);
        const unknownRelations = relations.filter(path => !meta.dataRelations.includes(path));
        if (unknownRelations.length) {
            const names = unknownRelations.map(p => JSON.stringify(p)).join(', ');
            throw new InternalServerError(
                `${names} of ${entityType.name} is not a channel-scoped relation custom field`,
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
     * Sets the values of the channel-scoped custom fields in the Channel of `ctx` on the
     * `customFields` object of every entity in `result` which has channel-scoped custom fields,
     * including the entities of loaded relations (e.g. `order.lines[].productVariant.product`), so
     * that `product.customFields.channelNote` reads the value of that Channel. Each entity type takes
     * one query, and rows already loaded by a ListQueryBuilder list are reused.
     *
     * The TransactionalConnection calls this after every read made with a RequestContext, so code
     * rarely needs to call it. Relation fields are not loaded, as with ordinary relation custom
     * fields, but the `<name>Id` of a single relation is set.
     *
     * @since 4.0.0
     */
    async applyChannelCustomFields(ctx: RequestContext, result: unknown): Promise<void> {
        const channelId = ctx.channelId;
        const fieldsByType = this.getChannelScopedFieldsByType();
        if (channelId == null || !fieldsByType.size || result == null || typeof result !== 'object') {
            return;
        }
        const found = new Map<AnyEntity, Map<string, any[]>>();
        const visited = new Set<object>();
        const visit = (value: unknown) => {
            if (value == null || typeof value !== 'object' || visited.has(value)) {
                return;
            }
            visited.add(value);
            if (Array.isArray(value)) {
                value.forEach(visit);
                return;
            }
            if (!(value instanceof VendureEntity)) {
                // e.g. the `{ entities, raw }` result of getRawAndEntities()
                if ('entities' in value) {
                    visit((value as any).entities);
                }
                return;
            }
            const type = value.constructor as AnyEntity;
            if (fieldsByType.has(type) && value.id != null) {
                const byId = found.get(type) ?? new Map<string, any[]>();
                const key = String(value.id);
                byId.set(key, [...(byId.get(key) ?? []), value]);
                found.set(type, byId);
            }
            // Loaded relations, including relations inside customFields. Only own data properties:
            // getters are skipped, such as the @Calculated properties which the entity subscriber
            // defines on loaded entities (e.g. Order.discounts throws if its lines are not joined),
            // and the getters of channel-scoped names on customFields.
            for (const property of ownDataValues(value)) {
                if (property && typeof property === 'object') {
                    if (property instanceof VendureEntity || Array.isArray(property)) {
                        visit(property);
                    } else if (!(property instanceof Date)) {
                        for (const nested of ownDataValues(property)) {
                            if (nested instanceof VendureEntity || Array.isArray(nested)) {
                                visit(nested);
                            }
                        }
                    }
                }
            }
        };
        visit(result);
        for (const [type, byId] of found) {
            const names = fieldsByType.get(type)?.columns ?? [];
            const toLoad: string[] = [];
            const rows = new Map<string, any>();
            for (const [id, entities] of byId) {
                const loaded = this.getLoadedAssignment(entities[0], channelId);
                if (loaded) {
                    rows.set(id, loaded);
                } else {
                    toLoad.push(id);
                }
            }
            if (toLoad.length) {
                for (const [id, row] of await this.getAssignments(ctx, type, toLoad, channelId)) {
                    rows.set(id, row);
                }
            }
            for (const [id, entities] of byId) {
                const row = rows.get(id);
                const values = row?.customFields;
                for (const entity of entities) {
                    if (row) {
                        // So that getChannelCustomFields() and the GraphQL resolver reuse it
                        entity[LOADED_CHANNEL_ASSIGNMENT_PROPERTY] = row;
                    }
                    const customFields = entity.customFields ?? (entity.customFields = {});
                    const loaded: Record<string, string> = {};
                    for (const name of names) {
                        // An entity which is not assigned to the Channel reads null, as in the API
                        customFields[name] = values?.[name] ?? null;
                        loaded[name] = JSON.stringify(customFields[name]);
                    }
                    this.loadedChannelValues.set(customFields, loaded);
                }
            }
        }
    }

    /**
     * The channel-scoped custom fields of each entity type, from the `customFields` of its assignment
     * entity: the columns (including the `<name>Id` of single relations), and the relations.
     */
    private getChannelScopedFieldsByType(): Map<AnyEntity, ChannelScopedFields> {
        if (!this.channelScopedFieldsByType) {
            const map = new Map<AnyEntity, ChannelScopedFields>();
            const metadatas = this.connection.rawConnection.entityMetadatas;
            for (const [target, options] of getChannelAssignmentEntities()) {
                const metadata = metadatas.find(m => m.target === target);
                const embedded = metadata?.embeddeds.find(e => e.propertyName === 'customFields');
                if (!embedded) {
                    continue;
                }
                const fields: ChannelScopedFields = {
                    columns: embedded.columns.map(c => c.propertyName).filter(name => !name.startsWith('__')),
                    singleRelations: embedded.relations.filter(r => !r.isManyToMany).map(r => r.propertyName),
                    listRelations: embedded.relations.filter(r => r.isManyToMany).map(r => r.propertyName),
                };
                if (fields.columns.length || fields.listRelations.length) {
                    map.set(options.entity(), fields);
                }
            }
            this.channelScopedFieldsByType = map;
        }
        return this.channelScopedFieldsByType;
    }

    /**
     * @description
     * Writes the channel-scoped custom field values which code has changed on the `customFields` of
     * the given entities since they were loaded (see {@link ChannelAssignmentService.applyChannelCustomFields})
     * to their assignment rows in the Channel of `ctx`. A single relation can be changed by setting
     * the related entity (or `null`) or its `<name>Id`, and a list relation by setting the array.
     *
     * The TransactionalConnection calls this after `save()` on a repository obtained with a
     * RequestContext. An entity which is not assigned to the Channel yet is skipped: entity services
     * write the values of their input once the entity is assigned.
     *
     * @since 4.0.0
     */
    async persistChannelCustomFields(
        ctx: RequestContext,
        result: unknown,
        entityType?: AnyEntity,
    ): Promise<void> {
        const channelId = ctx.channelId;
        const fieldsByType = this.getChannelScopedFieldsByType();
        if (channelId == null || !fieldsByType.size || result == null) {
            return;
        }
        // Entities, or plain objects with an id saved with the repository of `entityType`
        const entities = (Array.isArray(result) ? result : [result]).filter(
            (e): e is { id: ID; customFields?: Record<string, any> } =>
                e != null && typeof e === 'object' && (e as any).id != null,
        );
        for (const entity of entities) {
            const type = (entity instanceof VendureEntity ? entity.constructor : entityType) as AnyEntity;
            const fields = fieldsByType.get(type);
            const customFields: Record<string, any> | undefined = (entity as any).customFields;
            if (!fields || !customFields) {
                continue;
            }
            const loaded = this.loadedChannelValues.get(customFields) ?? {};
            const has = (name: string) => Object.prototype.hasOwnProperty.call(customFields, name);
            const changed = (name: string) =>
                has(name) && JSON.stringify(customFields[name] ?? null) !== (loaded[name] ?? 'null');
            const values: Record<string, unknown> = {};
            for (const name of fields.singleRelations) {
                if (has(name) && customFields[name] !== undefined) {
                    values[name] = customFields[name];
                } else if (changed(`${name}Id`)) {
                    const id = customFields[`${name}Id`];
                    values[name] = id == null ? null : { id };
                }
            }
            for (const name of fields.listRelations) {
                if (has(name) && Array.isArray(customFields[name])) {
                    values[name] = customFields[name];
                }
            }
            for (const name of fields.columns) {
                const isRelationId = fields.singleRelations.some(relation => `${relation}Id` === name);
                if (!isRelationId && changed(name)) {
                    values[name] = customFields[name];
                }
            }
            if (!Object.keys(values).length) {
                continue;
            }
            const meta = this.getMetadataOrThrow(type);
            const repo = this.connection.getRepository(ctx, meta.target);
            const row: any = await repo.findOne({
                where: { [meta.entityIdProperty]: entity.id, channelId },
                relations: findOptionsArrayToObject(meta.dataRelations),
            });
            if (!row) {
                continue;
            }
            row.customFields = { ...row.customFields, ...values };
            await repo.save(row, { reload: false });
            if (this.getLoadedAssignment(entity, channelId)) {
                // Replace the row loaded with the entity, which getChannelCustomFields() would reuse
                (entity as any)[LOADED_CHANNEL_ASSIGNMENT_PROPERTY] = row;
            }
            const written: Record<string, string> = { ...loaded };
            for (const name of fields.columns.filter(has)) {
                written[name] = JSON.stringify(customFields[name] ?? null);
            }
            for (const name of fields.singleRelations.filter(relation => relation in values)) {
                written[`${name}Id`] = JSON.stringify((values[name] as { id: ID } | null)?.id ?? null);
            }
            this.loadedChannelValues.set(customFields, written);
        }
    }

    /**
     * @description
     * Leaves out of `values` (channel-scoped custom field values to write, keyed by field name, with
     * single relations given as the related entity or `null`) those which the entity's `customFields`
     * already holds as written to the Channel: by a `save()` through the TransactionalConnection (see
     * {@link ChannelAssignmentService.persistChannelCustomFields}), or as loaded. So that entity
     * services, which also write the values of their input, do not write them twice.
     *
     * @internal
     */
    withoutPersistedValues(
        ctx: RequestContext,
        entity: object,
        channelId: ID,
        values: Record<string, unknown>,
    ): Record<string, unknown> {
        const customFields: object | undefined = (entity as any).customFields;
        const persisted = customFields && this.loadedChannelValues.get(customFields);
        if (!persisted || !idsAreEqual(channelId, ctx.channelId)) {
            return values;
        }
        const result: Record<string, unknown> = {};
        for (const [name, value] of Object.entries(values)) {
            if (Array.isArray(value)) {
                // List relations are not tracked
                result[name] = value;
                continue;
            }
            const isRelation =
                (value != null && typeof value === 'object' && 'id' in value) || `${name}Id` in persisted;
            const json = isRelation
                ? JSON.stringify((value as { id: ID } | null)?.id ?? null)
                : JSON.stringify(value ?? null);
            if (persisted[isRelation ? `${name}Id` : name] !== json) {
                result[name] = value;
            }
        }
        return result;
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
        const listRelations = this.getChannelScopedFieldsByType().get(entityType)?.listRelations ?? [];
        const channelValues = meta
            ? await this.getChannelCustomFields(ctx, entityType, entity, { relations: listRelations })
            : undefined;
        // Spreading copies only own properties, not the getters of channel-scoped names
        const result: Record<string, unknown> = { ...entity.customFields, ...channelValues };
        for (const name of listRelations) {
            // As create input, which takes list relations as `<name>Ids`
            const related = result[name];
            delete result[name];
            if (Array.isArray(related)) {
                result[`${name}Ids`] = related.map((item: { id: ID }) => item.id);
            }
        }
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

interface ChannelScopedFields {
    /** The columns, including the `<name>Id` of single relations */
    columns: string[];
    singleRelations: string[];
    listRelations: string[];
}

/**
 * Channel-scoped custom fields are read and written for a Channel. A RequestContext without one (e.g.
 * `RequestContext.empty()`) would otherwise drop the Channel from the query's `where`, which TypeORM
 * 0.3 ignores, and use the row of an arbitrary Channel.
 */
function requireChannelId(channelId: ID | undefined): ID {
    if (channelId == null) {
        throw new InternalServerError(
            'Channel-scoped custom fields are read and written for a Channel, but the RequestContext has ' +
                'none (e.g. RequestContext.empty()). Use a RequestContext of a Channel, or pass a channelId.',
        );
    }
    return channelId;
}

/**
 * The values of an object's own data properties, without calling any getters.
 */
function ownDataValues(value: object): unknown[] {
    const values: unknown[] = [];
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
        if ('value' in descriptor) {
            values.push(descriptor.value);
        }
    }
    return values;
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
