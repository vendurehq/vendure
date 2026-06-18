import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    DeletionResponse,
    MutationAssignRoleToAdministratorArgs,
    MutationCreateAdministratorArgs,
    MutationDeleteAdministratorArgs,
    MutationDeleteAdministratorsArgs,
    MutationUpdateActiveAdministratorArgs,
    MutationUpdateAdministratorArgs,
    Permission,
    QueryAdministratorArgs,
    QueryAdministratorsArgs,
} from '@vendure/common/lib/generated-types';
import { PaginatedList } from '@vendure/common/lib/shared-types';

import { Administrator } from '../../../entity/administrator/administrator.entity';
import { AdministratorService } from '../../../service/services/administrator.service';
import { RequestContext } from '../../common/request-context';
import { Allow } from '../../decorators/allow.decorator';
import { RelationPaths, Relations } from '../../decorators/relations.decorator';
import { Ctx } from '../../decorators/request-context.decorator';
import { Transaction } from '../../decorators/transaction.decorator';

@Resolver('Administrator')
export class AdministratorResolver {
    constructor(private administratorService: AdministratorService) {}

    @Query()
    @Allow(Permission.ReadAdministrator)
    administrators(
        @Ctx() ctx: RequestContext,
        @Args() args: QueryAdministratorsArgs,
        @Relations(Administrator) relations: RelationPaths<Administrator>,
    ): Promise<PaginatedList<Administrator>> {
        return this.administratorService.findAll(ctx, args.options || undefined, relations);
    }

    @Query()
    @Allow(Permission.ReadAdministrator)
    administrator(
        @Ctx() ctx: RequestContext,
        @Args() args: QueryAdministratorArgs,
        @Relations(Administrator) relations: RelationPaths<Administrator>,
    ): Promise<Administrator | undefined> {
        return this.administratorService.findOne(ctx, args.id, relations);
    }

    @Query()
    @Allow(Permission.Owner)
    async activeAdministrator(@Ctx() ctx: RequestContext): Promise<Administrator | undefined> {
        if (ctx.activeUserId) {
            return this.administratorService.findOneByUserId(ctx, ctx.activeUserId);
        }
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.CreateAdministrator)
    createAdministrator(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationCreateAdministratorArgs,
    ): Promise<Administrator> {
        const { input } = args;
        return this.administratorService.create(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateAdministrator)
    updateAdministrator(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationUpdateAdministratorArgs,
    ): Promise<Administrator> {
        const { input } = args;
        return this.administratorService.update(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Owner)
    async updateActiveAdministrator(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationUpdateActiveAdministratorArgs,
    ): Promise<Administrator | undefined> {
        if (ctx.activeUserId) {
            const { input } = args;
            const administrator = await this.administratorService.findOneByUserId(ctx, ctx.activeUserId);
            if (administrator) {
                return this.administratorService.update(ctx, { ...input, id: administrator.id });
            }
        }
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateAdministrator)
    assignRoleToAdministrator(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationAssignRoleToAdministratorArgs,
    ): Promise<Administrator> {
        return this.administratorService.assignRole(ctx, args.administratorId, args.roleId);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteAdministrator)
    deleteAdministrator(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationDeleteAdministratorArgs,
    ): Promise<DeletionResponse> {
        const { id } = args;
        return this.administratorService.softDelete(ctx, id);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteAdministrator)
    deleteAdministrators(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationDeleteAdministratorsArgs,
    ): Promise<DeletionResponse[]> {
        return Promise.all(args.ids.map(id => this.administratorService.softDelete(ctx, id)));
    }
}
