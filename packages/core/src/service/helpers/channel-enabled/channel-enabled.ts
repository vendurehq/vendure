import { ID } from '@vendure/common/lib/shared-types';
import { SelectQueryBuilder } from 'typeorm';

import { RequestContext } from '../../../api/common/request-context';
import { ProductChannel, ProductVariantChannel } from '../../../entity/channel-assignment/channel-assignment.entities';

/**
 * @description
 * The single place where a Product's or ProductVariant's global `enabled` value and its per-channel
 * value (`ProductChannel.enabled` / `ProductVariantChannel.enabled`, `null` when not set) combine.
 *
 * The rule is a pending UX decision (OSS-1001). This prototype uses a **master switch**: the entity is
 * enabled in a Channel only if it is enabled globally and not disabled in that Channel. The
 * alternative is an **override** (`channelEnabled ?? globalEnabled`), which only changes this function
 * and the two below.
 */
export function isEnabledInChannel(globalEnabled: boolean, channelEnabled: boolean | null | undefined): boolean {
    return globalEnabled && channelEnabled !== false;
}

/**
 * @description
 * The SQL form of {@link isEnabledInChannel}, joining the assignment row of the active Channel.
 * `entityAlias` is the alias of the Product or ProductVariant in the query.
 */
export function whereEnabledInChannel(
    qb: SelectQueryBuilder<any>,
    ctx: RequestContext,
    entity: 'product' | 'productVariant',
    entityAlias: string,
): SelectQueryBuilder<any> {
    const rowAlias = `${entityAlias}__channelAssignment`;
    const target = entity === 'product' ? ProductChannel : ProductVariantChannel;
    const idColumn = entity === 'product' ? 'productId' : 'productVariantId';
    return qb
        .innerJoin(
            target,
            rowAlias,
            `${rowAlias}.${idColumn} = ${entityAlias}.id AND ${rowAlias}.channelId = :${rowAlias}ChannelId`,
            { [`${rowAlias}ChannelId`]: ctx.channelId },
        )
        .andWhere(`${entityAlias}.enabled = :${rowAlias}True`, { [`${rowAlias}True`]: true })
        .andWhere(`(${rowAlias}.enabled IS NULL OR ${rowAlias}.enabled = :${rowAlias}True)`);
}

/**
 * @description
 * The ListQueryBuilder filter form of {@link isEnabledInChannel}, for lists scoped to the active
 * Channel. `enabledInChannel` is the per-channel column, resolved by the ListQueryBuilder.
 */
export function enabledInChannelFilter(): any {
    return {
        _and: [
            { enabled: { eq: true } },
            { _or: [{ enabledInChannel: { isNull: true } }, { enabledInChannel: { eq: true } }] },
        ],
    };
}
