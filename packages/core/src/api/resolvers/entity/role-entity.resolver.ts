import { Parent, ResolveField, Resolver } from '@nestjs/graphql';

import { TransactionalConnection } from '../../../connection/transactional-connection';
import { Channel } from '../../../entity/channel/channel.entity';
import { Role } from '../../../entity/role/role.entity';
import { RequestContext } from '../../common/request-context';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver('Role')
export class RoleEntityResolver {
    constructor(private connection: TransactionalConnection) {}

    @ResolveField()
    async channel(@Ctx() ctx: RequestContext, @Parent() role: Role): Promise<Channel | null> {
        if (role.channel) {
            return role.channel;
        }
        if (role.channelId == null) {
            return null;
        }
        return this.connection.getEntityOrThrow(ctx, Channel, role.channelId);
    }
}
