import { ProductFilterParameter } from '@vendure/common/lib/generated-types';
import { Type } from '@vendure/common/lib/shared-types';
import { SelectQueryBuilder } from 'typeorm';

import { RequestContext } from '../../../api/common/request-context';
import { InternalServerError } from '../../../common/error/errors';
import type { ProductVariant } from '../../../entity/product-variant/product-variant.entity';
import type { Product } from '../../../entity/product/product.entity';
import { findChannelAssignmentEntity } from '../channel-assignment/channel-assignment.service';

/**
 * @description
 * Decides whether a {@link Product} or {@link ProductVariant} is available in a Channel, from its
 * global `enabled` value and its value in that Channel (`ProductChannel.enabled` /
 * `ProductVariantChannel.enabled`, exposed as `enabledInChannel`, `null` when not set).
 *
 * The global value is a master switch: the entity is available in a Channel only if it is enabled
 * globally and not disabled in that Channel. See https://github.com/vendurehq/vendure/issues/3777.
 *
 * This function, {@link whereEnabledInChannel} and {@link enabledInChannelFilter} are the only
 * places that combine the two values. Use them rather than reading `enabled` directly.
 *
 * @docsCategory products & stock
 * @since 4.0.0
 */
export function isEnabledInChannel(
    globalEnabled: boolean,
    channelEnabled: boolean | null | undefined,
): boolean {
    return globalEnabled && channelEnabled !== false;
}

/**
 * @description
 * The SQL form of {@link isEnabledInChannel}: restricts the query to entities which are available
 * in the active Channel, joining their channel assignment row. `alias` is the alias of the Product
 * or ProductVariant in the query.
 *
 * @docsCategory products & stock
 * @since 4.0.0
 */
export function whereEnabledInChannel(
    qb: SelectQueryBuilder<any>,
    ctx: RequestContext,
    entityType: Type<Product> | Type<ProductVariant>,
    alias: string,
): SelectQueryBuilder<any> {
    const assignment = findChannelAssignmentEntity(qb.connection.entityMetadatas, entityType);
    if (!assignment) {
        throw new InternalServerError(`${entityType.name} has no channel assignment entity`);
    }
    const rowAlias = `${alias}__channelAssignment`;
    const idProperty = `${assignment.options.entityProperty}Id`;
    return qb
        .innerJoin(
            assignment.metadata.target,
            rowAlias,
            `${rowAlias}.${idProperty} = ${alias}.id AND ${rowAlias}.channelId = :${rowAlias}ChannelId`,
            { [`${rowAlias}ChannelId`]: ctx.channelId },
        )
        .andWhere(`${alias}.enabled = :${rowAlias}True`, { [`${rowAlias}True`]: true })
        .andWhere(`(${rowAlias}.enabled IS NULL OR ${rowAlias}.enabled = :${rowAlias}True)`);
}

/**
 * @description
 * The ListQueryBuilder filter form of {@link isEnabledInChannel}, for Product lists scoped to the
 * active Channel. `enabledInChannel` is resolved by the ListQueryBuilder against the active
 * Channel's `ProductChannel` row.
 *
 * @docsCategory products & stock
 * @since 4.0.0
 */
export function enabledInChannelFilter(): ProductFilterParameter {
    return {
        _and: [
            { enabled: { eq: true } },
            { _or: [{ enabledInChannel: { isNull: true } }, { enabledInChannel: { eq: true } }] },
        ],
    };
}
