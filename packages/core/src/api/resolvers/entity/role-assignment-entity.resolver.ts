import { Parent, ResolveField, Resolver } from '@nestjs/graphql';

import { TransactionalConnection } from '../../../connection/transactional-connection';
import { Channel } from '../../../entity/channel/channel.entity';
import { RoleAssignment } from '../../../entity/role-assignment/role-assignment.entity';
import { Role } from '../../../entity/role/role.entity';
import { User } from '../../../entity/user/user.entity';
import { RequestContext } from '../../common/request-context';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver('RoleAssignment')
export class RoleAssignmentEntityResolver {
    constructor(private connection: TransactionalConnection) {}

    @ResolveField()
    async user(@Ctx() ctx: RequestContext, @Parent() assignment: RoleAssignment): Promise<User> {
        if (assignment.user) {
            return assignment.user;
        }
        return this.connection.getEntityOrThrow(ctx, User, assignment.userId);
    }

    @ResolveField()
    async role(@Ctx() ctx: RequestContext, @Parent() assignment: RoleAssignment): Promise<Role> {
        if (assignment.role) {
            return assignment.role;
        }
        return this.connection.getEntityOrThrow(ctx, Role, assignment.roleId);
    }

    @ResolveField()
    async channel(@Ctx() ctx: RequestContext, @Parent() assignment: RoleAssignment): Promise<Channel> {
        if (assignment.channel) {
            return assignment.channel;
        }
        return this.connection.getEntityOrThrow(ctx, Channel, assignment.channelId);
    }
}
