import { Injectable } from '@nestjs/common';
import { ID, Type } from '@vendure/common/lib/shared-types';
import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

import { RequestContext } from '../../../api/common/request-context';
import {
    ProductChannel,
    ProductVariantChannel,
} from '../../../entity/channel-assignment/channel-assignment.entities';
import { ProductVariant } from '../../../entity/product-variant/product-variant.entity';
import { Product } from '../../../entity/product/product.entity';
import { ChannelAssignmentService } from '../channel-assignment/channel-assignment.service';

/**
 * @description
 * The entity types which can be enabled or disabled per Channel.
 *
 * @docsCategory service-helpers
 * @docsPage ChannelEnabledChecker
 * @since 4.0.0
 */
export type ChannelEnabledEntityType = Type<Product> | Type<ProductVariant>;

/**
 * @description
 * Decides whether a {@link Product} or {@link ProductVariant} is available in a Channel, from its
 * global `enabled` value and its `enabled` value in that Channel (`ProductChannel.enabled` /
 * `ProductVariantChannel.enabled`, exposed in the Admin API as `enabledInChannel`).
 *
 * The global value is a master switch: the entity is available in a Channel only if it is enabled
 * globally and enabled in that Channel. `enabledInChannel` is `undefined` if the entity is not
 * assigned to the Channel, in which case it is not available there either.
 *
 * This is the pure form of {@link ChannelEnabledChecker}, for code which already has both values,
 * such as search indexers.
 *
 * @docsCategory service-helpers
 * @docsPage ChannelEnabledChecker
 * @since 4.0.0
 */
export function isEnabledInChannel(enabled: boolean, enabledInChannel: boolean | undefined): boolean {
    return enabled && enabledInChannel === true;
}

/**
 * @description
 * The {@link ListQueryBuilder} filter which restricts a Product list to Products available in the
 * Channel the list is scoped to (see {@link isEnabledInChannel}). The list must be scoped to a
 * Channel (the `channelId` option of `ListQueryBuilder.build()`, as `ProductService.findAll()`
 * does): the ListQueryBuilder then resolves `enabledInChannel` against the `ProductChannel` row
 * of that Channel. It is named `enabledInChannel` rather than `enabled` because `Product.enabled`
 * is the global value.
 *
 * @docsCategory service-helpers
 * @docsPage ChannelEnabledChecker
 * @since 4.0.0
 */
export interface EnabledInChannelFilter {
    enabled: { eq: true };
    enabledInChannel: { eq: true };
}

/**
 * @description
 * Returns the {@link EnabledInChannelFilter}, to be combined with any other filter of the list
 * with `_and`.
 *
 * @docsCategory service-helpers
 * @docsPage ChannelEnabledChecker
 * @since 4.0.0
 */
export function enabledInChannelFilter(): EnabledInChannelFilter {
    return { enabled: { eq: true }, enabledInChannel: { eq: true } };
}

/**
 * @description
 * Checks and sets whether Products and ProductVariants are available in a Channel. A Product or
 * ProductVariant is available in a Channel only if it is enabled globally (`enabled`) *and*
 * enabled in that Channel (the `enabled` column of its {@link ProductChannel} /
 * {@link ProductVariantChannel} row, `enabledInChannel` in the Admin API). See
 * {@link isEnabledInChannel}.
 *
 * Use this helper rather than reading `enabled` directly when deciding what customers can see or
 * buy in a Channel.
 *
 * @example
 * ```ts
 * export class MyCustomService {
 *   constructor(private connection: TransactionalConnection,
 *               private channelEnabledChecker: ChannelEnabledChecker) {}
 *
 *   getAvailableVariants(ctx: RequestContext, productId: ID) {
 *     const qb = this.connection
 *       .getRepository(ctx, ProductVariant)
 *       .createQueryBuilder('variant')
 *       .where('variant.productId = :productId', { productId });
 *     this.channelEnabledChecker.applyToQuery(ctx, qb, ProductVariant);
 *     return qb.getMany();
 *   }
 * }
 * ```
 *
 * @docsCategory service-helpers
 * @since 4.0.0
 */
@Injectable()
export class ChannelEnabledChecker {
    constructor(private channelAssignmentService: ChannelAssignmentService) {}

    /**
     * @description
     * Returns whether the entity is available in the active Channel: enabled globally, assigned to
     * the active Channel and enabled there. Calls made in the same tick are batched into one query
     * per entity type.
     */
    async isEnabled(
        ctx: RequestContext,
        entityType: ChannelEnabledEntityType,
        entity: { id: ID; enabled: boolean },
    ): Promise<boolean> {
        if (!entity.enabled) {
            return false;
        }
        const assignment = await this.channelAssignmentService.getAssignment<
            ProductChannel | ProductVariantChannel
        >(ctx, entityType, entity);
        return isEnabledInChannel(entity.enabled, assignment?.enabled);
    }

    /**
     * @description
     * Restricts the query to entities which are available in the active Channel, by joining their
     * assignment row in that Channel. This also restricts the query to entities assigned to the
     * active Channel, so no separate join on `channels` is needed. `alias` is the alias of the
     * Product or ProductVariant in the query, and defaults to the query's main alias.
     */
    applyToQuery<T extends ObjectLiteral>(
        ctx: RequestContext,
        qb: SelectQueryBuilder<T>,
        entityType: ChannelEnabledEntityType,
        alias: string = qb.alias,
    ): void {
        const { target, entityIdProperty } = this.channelAssignmentService.getMetadataOrThrow(entityType);
        const rowAlias = `${alias}__enabledInChannel`;
        const channelIdParam = `${rowAlias}ChannelId`;
        const enabledParam = `${rowAlias}Enabled`;
        qb.innerJoin(
            target,
            rowAlias,
            `${rowAlias}.${entityIdProperty} = ${alias}.id AND ${rowAlias}.channelId = :${channelIdParam}`,
            { [channelIdParam]: ctx.channelId },
        ).andWhere(`(${alias}.enabled = :${enabledParam} AND ${rowAlias}.enabled = :${enabledParam})`, {
            [enabledParam]: true,
        });
    }

    /**
     * @description
     * Sets whether the entities are enabled in the given Channel (defaults to the active Channel)
     * from the `enabledInChannel` field of a create, update or assign-to-channel input. Does nothing
     * if the field is omitted. The entities must already be assigned to the Channel.
     */
    async updateEnabledInChannel(
        ctx: RequestContext,
        entityType: ChannelEnabledEntityType,
        entityIds: ID | ID[],
        input: { enabledInChannel?: boolean | null },
        channelId: ID = ctx.channelId,
    ): Promise<void> {
        if (input.enabledInChannel == null) {
            return;
        }
        await this.channelAssignmentService.update<ProductChannel | ProductVariantChannel>(
            ctx,
            entityType,
            Array.isArray(entityIds) ? entityIds : [entityIds],
            [channelId],
            { enabled: input.enabledInChannel },
        );
    }
}
