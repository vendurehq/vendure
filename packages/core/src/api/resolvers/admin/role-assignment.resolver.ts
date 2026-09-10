import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    MutationAssignRolesToUserArgs,
    MutationRemoveRolesFromUserArgs,
    Permission,
    QueryRoleAssignmentsArgs,
} from '@vendure/common/lib/generated-types';
import { PaginatedList } from '@vendure/common/lib/shared-types';

import { assertFound } from '../../../common/utils';
import { RoleAssignment } from '../../../entity/role-assignment/role-assignment.entity';
import { User } from '../../../entity/user/user.entity';
import { RoleAssignmentService } from '../../../service/services/role-assignment.service';
import { UserService } from '../../../service/services/user.service';
import { RequestContext } from '../../common/request-context';
import { Allow } from '../../decorators/allow.decorator';
import { RelationPaths, Relations } from '../../decorators/relations.decorator';
import { Ctx } from '../../decorators/request-context.decorator';
import { Transaction } from '../../decorators/transaction.decorator';

@Resolver('RoleAssignments')
export class RoleAssignmentResolver {
    constructor(
        private roleAssignmentService: RoleAssignmentService,
        private userService: UserService,
    ) {}

    @Query()
    @Allow(Permission.ReadAdministrator)
    roleAssignments(
        @Ctx() ctx: RequestContext,
        @Args() args: QueryRoleAssignmentsArgs,
        @Relations(RoleAssignment) relations: RelationPaths<RoleAssignment>,
    ): Promise<PaginatedList<RoleAssignment>> {
        return this.roleAssignmentService.findAll(ctx, args.options || undefined, relations);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateAdministrator)
    async assignRolesToUser(
        @Ctx() ctx: RequestContext,
        @Args() { input }: MutationAssignRolesToUserArgs,
    ): Promise<User> {
        await this.roleAssignmentService.assign(ctx, input.userId, input.assignments);
        return assertFound(this.userService.getUserById(ctx, input.userId));
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateAdministrator)
    async removeRolesFromUser(
        @Ctx() ctx: RequestContext,
        @Args() { input }: MutationRemoveRolesFromUserArgs,
    ): Promise<User> {
        await this.roleAssignmentService.remove(ctx, input.userId, input.assignments);
        return assertFound(this.userService.getUserById(ctx, input.userId));
    }
}
