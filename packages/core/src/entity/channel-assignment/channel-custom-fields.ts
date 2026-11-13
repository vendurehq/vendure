import { ID, Type } from '@vendure/common/lib/shared-types';

import type { RequestContext } from '../../api/common/request-context';
import { InternalServerError } from '../../common/error/errors';

/**
 * @description
 * Options for reading the `channelScoped` custom fields of an entity, e.g. with
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
    relations?: Array<keyof Fields & string>;
    /**
     * @description
     * The Channel to read the values of. Defaults to the active Channel of the RequestContext.
     */
    channelId?: ID;
}

/**
 * Reads the channel-scoped custom fields of an entity. Implemented by the ChannelAssignmentService,
 * which registers itself on bootstrap, so that entity classes can read them without importing it.
 */
interface ChannelCustomFieldsReader {
    getChannelCustomFields(
        ctx: RequestContext,
        entityType: Type<any>,
        entity: { id: ID },
        options?: ChannelCustomFieldsOptions<any>,
    ): Promise<Record<string, unknown> | undefined>;
}

let reader: ChannelCustomFieldsReader | undefined;

/**
 * @internal
 * Called by the ChannelAssignmentService on bootstrap. Like `getConfig()`, it is process-wide: the
 * most recently bootstrapped app serves the reads.
 */
export function setChannelCustomFieldsReader(value: ChannelCustomFieldsReader | undefined) {
    reader = value;
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
    if (!reader) {
        throw new InternalServerError(
            `Cannot read the channel-scoped custom fields of ${entityType.name} before the app has bootstrapped`,
        );
    }
    if (entity.id == null) {
        // Not saved yet, so not assigned to any Channel
        return undefined;
    }
    return (await reader.getChannelCustomFields(ctx, entityType, entity, options)) as Fields | undefined;
}
