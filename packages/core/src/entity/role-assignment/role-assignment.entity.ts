import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Entity, Index, ManyToOne, Unique } from 'typeorm';

import { VendureEntity } from '../base/base.entity';
import { Channel } from '../channel/channel.entity';
import { EntityId } from '../entity-id.decorator';
import { Role } from '../role/role.entity';
import { User } from '../user/user.entity';

/**
 * @description
 * A RoleAssignment grants a {@link User} the permissions of a {@link Role} on a specific
 * {@link Channel}. It is the source of truth for permission resolution: a Role is a
 * channel-agnostic template, and the RoleAssignment supplies the channel scope at the
 * moment the Role is granted to a User. This allows a single Role definition to be
 * shared across many Users, each scoped to their own Channels.
 *
 * The SuperAdmin Role is the one exception to the channel scope: it is held on every
 * Channel or not at all, so it is stored as a single row on the default Channel, which
 * stands for all Channels. SuperAdmin access is derived at check time by the
 * {@link RolePermissionResolver} and never depends on which Channel that row names;
 * {@link RoleAssignmentService.assign} and {@link RoleAssignmentService.remove} rewrite a
 * SuperAdmin pair on any Channel to the default-channel row.
 *
 * @docsCategory entities
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
