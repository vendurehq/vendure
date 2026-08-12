import { Parent, ResolveField, Resolver } from '@nestjs/graphql';

import { TransactionalConnection } from '../../../connection/transactional-connection';
import { Administrator } from '../../../entity/administrator/administrator.entity';
import { Channel } from '../../../entity/channel/channel.entity';
import { Role } from '../../../entity/role/role.entity';
import { User } from '../../../entity/user/user.entity';
import { ChannelRoleService } from '../../../service/services/channel-role.service';
import { RequestContext } from '../../common/request-context';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver('Administrator')
export class AdministratorEntityResolver {
    constructor(
        private connection: TransactionalConnection,
        private channelRoleService: ChannelRoleService,
    ) {}

    @ResolveField()
    async user(@Ctx() ctx: RequestContext, @Parent() administrator: Administrator): Promise<User> {
        if (administrator.user) {
            return administrator.user;
        }
        const { user } = await this.connection.getEntityOrThrow(ctx, Administrator, administrator.id, {
            relations: {
                user: { roles: true },
            },
        });
        return user;
    }

    @ResolveField()
    async channelRoles(
        @Ctx() ctx: RequestContext,
        @Parent() administrator: Administrator,
    ): Promise<Array<{ role: Role; channels: Channel[] }>> {
        if (!this.channelRoleService.enabled) {
            return [];
        }
        const user = await this.user(ctx, administrator);
        const channelRoles = await this.channelRoleService.findByUserId(ctx, user.id);
        // Grouped by Role so that a Role granted on many Channels is a single entry, rather than one
        // entry per Channel.
        const byRole = new Map<string, { role: Role; channels: Channel[] }>();
        for (const channelRole of channelRoles) {
            const key = String(channelRole.roleId);
            const entry = byRole.get(key) ?? { role: channelRole.role, channels: [] };
            entry.channels.push(channelRole.channel);
            byRole.set(key, entry);
        }
        return [...byRole.values()];
    }
}
