import { EntityMetadata } from 'typeorm';

import { Channel } from '../../../entity/channel/channel.entity';

/**
 * Returns true if the given entity metadata describes an entity which implements the
 * {@link ChannelAware} interface, i.e. it has a many-to-many `channels` relation to Channel.
 *
 * The relation must be many-to-many: a one-to-many `channels` relation, as found on Seller,
 * means "the Channels owned by this entity" rather than "the Channels this entity belongs to".
 */
export function isChannelAwareMetadata(metadata: EntityMetadata): boolean {
    return metadata.relations.some(
        r => r.propertyName === 'channels' && r.isManyToMany && r.type === Channel,
    );
}
