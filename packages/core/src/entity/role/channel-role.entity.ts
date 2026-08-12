import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Entity, Index, ManyToOne } from 'typeorm';

import { VendureEntity } from '../base/base.entity';
import { Channel } from '../channel/channel.entity';
import { EntityId } from '../entity-id.decorator';
import { Role } from '../role/role.entity';
import { User } from '../user/user.entity';

/**
 * @description
 * A ChannelRole grants the {@link Permission}s of a {@link Role} to a {@link User} on a single
 * {@link Channel}. This allows a Role to be shared between many Channels while each User remains
 * restricted to the Channels they were explicitly granted.
 *
 * ChannelRoles are only taken into account when the `authOptions.channelScopedRoles` config option
 * is set to `true`. Otherwise a User's permissions are resolved solely from `User.roles` and the
 * Channels assigned to those Roles.
 *
 * @docsCategory entities
 * @since 3.8.0
 * @experimental
 */
@Entity()
@Index(['userId', 'roleId', 'channelId'], { unique: true })
export class ChannelRole extends VendureEntity {
    constructor(input?: DeepPartial<ChannelRole>) {
        super(input);
    }

    @Index()
    @ManyToOne(type => User, { onDelete: 'CASCADE' })
    user: User;

    @EntityId()
    userId: ID;

    @ManyToOne(type => Role, { onDelete: 'CASCADE' })
    role: Role;

    @EntityId()
    roleId: ID;

    @ManyToOne(type => Channel, { onDelete: 'CASCADE' })
    channel: Channel;

    @EntityId()
    channelId: ID;
}
