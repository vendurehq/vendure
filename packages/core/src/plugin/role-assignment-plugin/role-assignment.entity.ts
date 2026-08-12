import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Entity, Index, ManyToOne, Unique } from 'typeorm';

import { VendureEntity } from '../../entity/base/base.entity';
import { Channel } from '../../entity/channel/channel.entity';
import { EntityId } from '../../entity/entity-id.decorator';
import { Role } from '../../entity/role/role.entity';
import { User } from '../../entity/user/user.entity';

/**
 * A RoleAssignment is a bridge entity which associates a User with a Role on a specific
 * Channel. It decouples Role definitions from Channel assignments, allowing the same Role
 * to be shared across multiple Users on different Channels, rather than requiring the Role
 * itself to be duplicated per Channel.
 *
 * This entity is only registered when the experimental `RoleAssignmentPlugin` is added
 * to the `plugins` array.
 */
@Entity()
@Unique('IDX_ROLE_ASSIGNMENT_USER_ROLE_CHANNEL', ['user', 'role', 'channel'])
export class RoleAssignment extends VendureEntity {
    constructor(input?: DeepPartial<RoleAssignment>) {
        super(input);
    }

    // No separate index on userId: the unique constraint's composite index
    // already covers lookups by user via its leftmost column.
    @ManyToOne(type => User, { onDelete: 'CASCADE' })
    user: User;

    @EntityId()
    userId: ID;

    @Index()
    @ManyToOne(type => Role, { onDelete: 'CASCADE' })
    role: Role;

    @EntityId()
    roleId: ID;

    @Index()
    @ManyToOne(type => Channel, { onDelete: 'CASCADE' })
    channel: Channel;

    @EntityId()
    channelId: ID;
}
