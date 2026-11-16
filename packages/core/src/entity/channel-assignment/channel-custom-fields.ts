import { ID, Type } from '@vendure/common/lib/shared-types';

import type { RequestContext } from '../../api/common/request-context';
import { InternalServerError } from '../../common/error/errors';
import type { VendureEntity } from '../base/base.entity';

/**
 * @description
 * The names of the relation fields among the given channel-scoped custom fields: those whose type
 * is an entity or a list of entities.
 *
 * @docsCategory entities
 * @since 4.0.0
 */
export type ChannelCustomFieldRelations<Fields> = {
    [K in keyof Fields]-?: NonNullable<Fields[K]> extends VendureEntity | VendureEntity[] ? K : never;
}[keyof Fields] &
    string;

/**
 * @description
 * Options for reading the channel-scoped custom fields of an entity, e.g. with
 * `product.getChannelCustomFields(ctx, options)`.
 *
 * @docsCategory entities
 * @since 4.0.0
 */
export interface ChannelCustomFieldsOptions<Fields> {
    /**
     * @description
     * The relation fields to load. Other relation fields are not set.
     */
    relations?: Array<ChannelCustomFieldRelations<Fields>>;
    /**
     * @description
     * The Channel to read the values of. Defaults to the active Channel of the RequestContext.
     */
    channelId?: ID;
}

/**
 * Reads and writes the channel-scoped custom fields of entities. Implemented by the
 * ChannelAssignmentService, which registers itself on bootstrap, so that entity classes and the
 * TransactionalConnection can use it without importing it.
 */
interface ChannelCustomFieldsStore {
    getChannelCustomFields(
        ctx: RequestContext,
        entityType: Type<any>,
        entity: { id: ID },
        options?: ChannelCustomFieldsOptions<any>,
    ): Promise<Record<string, unknown> | undefined>;
    applyChannelCustomFields(ctx: RequestContext, result: unknown): Promise<void>;
    persistChannelCustomFields(ctx: RequestContext, result: unknown, entityType?: unknown): Promise<void>;
}

/**
 * The stores of the apps bootstrapped in this process, e.g. a server and a worker. Like
 * `getConfig()`, reads are process-wide: the most recently bootstrapped app which is still running
 * serves them.
 */
const stores: ChannelCustomFieldsStore[] = [];

/**
 * @internal
 * Called by the ChannelAssignmentService on bootstrap.
 */
export function registerChannelCustomFieldsStore(value: ChannelCustomFieldsStore) {
    stores.push(value);
}

/**
 * @internal
 * Called by the ChannelAssignmentService on shutdown, so that a closed app no longer serves reads.
 */
export function unregisterChannelCustomFieldsStore(value: ChannelCustomFieldsStore) {
    const index = stores.lastIndexOf(value);
    if (index !== -1) {
        stores.splice(index, 1);
    }
}

/**
 * @internal
 * The implementation of the `getChannelCustomFields()` method of ChannelAware entities.
 */
export async function readChannelCustomFields<Fields>(
    ctx: RequestContext,
    entityType: Type<any>,
    entity: { id: ID },
    options?: ChannelCustomFieldsOptions<Fields>,
): Promise<Fields | undefined> {
    const store = stores[stores.length - 1];
    if (!store) {
        throw new InternalServerError(
            `Cannot read the channel-scoped custom fields of ${entityType.name} before the app has bootstrapped`,
        );
    }
    if (entity.id == null) {
        // Not saved yet, so not assigned to any Channel
        return undefined;
    }
    return (await store.getChannelCustomFields(ctx, entityType, entity, options)) as Fields | undefined;
}

/**
 * @internal
 * Sets the values of the channel-scoped custom fields in the Channel of `ctx` on the `customFields`
 * of the entities in `result` (the result of a repository or QueryBuilder read, including the
 * entities of its loaded relations). Called by the TransactionalConnection after reads.
 */
export async function applyChannelCustomFields(ctx: RequestContext, result: unknown): Promise<void> {
    const store = stores[stores.length - 1];
    if (store) {
        await store.applyChannelCustomFields(ctx, result);
    }
}

/**
 * @internal
 * Writes the channel-scoped custom field values which have changed on the `customFields` of the
 * saved entities to the Channel of `ctx`. Called by the TransactionalConnection after `save()`.
 */
export async function persistChannelCustomFields(
    ctx: RequestContext,
    result: unknown,
    entityType?: unknown,
): Promise<void> {
    const store = stores[stores.length - 1];
    if (store) {
        await store.persistChannelCustomFields(ctx, result, entityType);
    }
}
