import { Type } from '@vendure/common/lib/shared-types';
import { DataSource } from 'typeorm';

import { ProductVariant } from '../../../entity/product-variant/product-variant.entity';
import { Product } from '../../../entity/product/product.entity';

/**
 * How the target entity of a relation custom field is scoped. Decides which related entities a
 * relation custom field may link to, and which it returns.
 */
export interface RelationTargetScope {
    /**
     * The target has a `channels` relation. Only entities assigned to the active Channel can be
     * linked, and only those are returned.
     */
    channelAware: boolean;
    /**
     * The target has a `deletedAt` column. The Shop API does not return soft-deleted entities.
     */
    softDeletable: boolean;
    /**
     * The target is a Product or ProductVariant. The Shop API returns only those available in the
     * active Channel (see `ChannelEnabledChecker`).
     */
    channelEnabled: boolean;
}

const cache = new WeakMap<DataSource, Map<Type<any>, RelationTargetScope>>();

export function getRelationTargetScope(dataSource: DataSource, entity: Type<any>): RelationTargetScope {
    let byEntity = cache.get(dataSource);
    if (!byEntity) {
        byEntity = new Map();
        cache.set(dataSource, byEntity);
    }
    let scope = byEntity.get(entity);
    if (!scope) {
        const metadata = dataSource.getMetadata(entity);
        scope = {
            channelAware: metadata.relations.some(r => r.propertyPath === 'channels'),
            softDeletable: metadata.columns.some(c => c.propertyPath === 'deletedAt'),
            channelEnabled: entity === Product || entity === ProductVariant,
        };
        byEntity.set(entity, scope);
    }
    return scope;
}

/**
 * Whether reading the relation must go through a scoped query, rather than returning an
 * eager-loaded value as it is.
 */
export function isScopedRelationTarget(scope: RelationTargetScope): boolean {
    return scope.channelAware || scope.softDeletable || scope.channelEnabled;
}
