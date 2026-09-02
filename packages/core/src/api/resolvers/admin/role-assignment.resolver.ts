import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    MutationSetRoleAssignmentsForUserArgs,
    Permission,
    QueryRoleAssignmentsArgs,
} from '@vendure/common/lib/generated-types';
import { PaginatedList } from '@vendure/common/lib/shared-types';

import { RoleAssignment } from '../../../entity/role-assignment/role-assignment.entity';
import { User } from '../../../entity/user/user.entity';
import { AdministratorService } from '../../../service/services/administrator.service';
import { RoleAssignmentService } from '../../../service/services/role-assignment.service';
import { RequestContext } from '../../common/request-context';
import { Allow } from '../../decorators/allow.decorator';
import { RelationPaths, Relations } from '../../decorators/relations.decorator';
import { Ctx } from '../../decorators/request-context.decorator';
import { Transaction } from '../../decorators/transaction.decorator';

@Resolver('RoleAssignments')
export class RoleAssignmentResolver {
    constructor(
        private roleAssignmentService: RoleAssignmentService,
        private administratorService: AdministratorService,
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
    setRoleAssignmentsForUser(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationSetRoleAssignmentsForUserArgs,
    ): Promise<User> {
        return this.administratorService.setRoleAssignmentsForUser(ctx, args.userId, args.assignments);
    }
}
