import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    DeletionResponse,
    MutationCreateRoleArgs,
    MutationDeleteRoleArgs,
    MutationDeleteRolesArgs,
    MutationUpdateRoleArgs,
    Permission,
    QueryRoleArgs,
    QueryRolesArgs,
} from '@vendure/common/lib/generated-types';
import { PaginatedList } from '@vendure/common/lib/shared-types';

import { Role } from '../../../entity/role/role.entity';
import { RoleService } from '../../../service/services/role.service';
import { RequestContext } from '../../common/request-context';
import { Allow } from '../../decorators/allow.decorator';
import { RelationPaths, Relations } from '../../decorators/relations.decorator';
import { Ctx } from '../../decorators/request-context.decorator';
import { Transaction } from '../../decorators/transaction.decorator';

@Resolver('Roles')
export class RoleResolver {
    constructor(private roleService: RoleService) {}

    @Query()
    @Allow(Permission.ReadAdministrator)
    roles(
        @Ctx() ctx: RequestContext,
        @Args() args: QueryRolesArgs,
        @Relations(Role) relations: RelationPaths<Role>,
    ): Promise<PaginatedList<Role>> {
        return this.roleService.findAll(ctx, args.options || undefined, relations);
    }

    @Query()
    @Allow(Permission.ReadAdministrator)
    role(
        @Ctx() ctx: RequestContext,
        @Args() args: QueryRoleArgs,
        @Relations(Role) relations: RelationPaths<Role>,
    ): Promise<Role | undefined> {
        return this.roleService.findOne(ctx, args.id, relations);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.CreateAdministrator)
    createRole(@Ctx() ctx: RequestContext, @Args() args: MutationCreateRoleArgs): Promise<Role> {
        const { input } = args;
        return this.roleService.create(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateAdministrator)
    updateRole(@Ctx() ctx: RequestContext, @Args() args: MutationUpdateRoleArgs): Promise<Role> {
        const { input } = args;
        return this.roleService.update(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteAdministrator)
    deleteRole(@Ctx() ctx: RequestContext, @Args() args: MutationDeleteRoleArgs): Promise<DeletionResponse> {
        const { id } = args;
        return this.roleService.delete(ctx, id);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteAdministrator)
    deleteRoles(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationDeleteRolesArgs,
    ): Promise<DeletionResponse[]> {
        return Promise.all(args.ids.map(id => this.roleService.delete(ctx, id)));
    }
}
