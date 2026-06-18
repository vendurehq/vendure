import { ID, Type } from '@vendure/common/lib/shared-types';
import { Connection } from 'typeorm';

import { VendureEntity } from '../../../entity/base/base.entity';

import { WhereCondition } from './parse-filter-params';

/**
 * Creates a WhereCondition for a channel-aware entity, filtering for only those entities
 * which are assigned to the channel specified by channelId,
 */
export function parseChannelParam<T extends VendureEntity>(
    connection: Connection,
    entity: Type<T>,
    channelId: ID,
    entityAlias?: string,
): WhereCondition | undefined {
    const metadata = connection.getMetadata(entity);
    const alias = entityAlias ?? metadata.name.toLowerCase();
    const relations = metadata.relations;
    const channelRelation = relations.find(r => r.propertyName === 'channels');
    if (!channelRelation) {
        return;
    }
    return {
        clause: `${alias}__channels.id = :channelId`,
        parameters: { channelId },
    };
}
