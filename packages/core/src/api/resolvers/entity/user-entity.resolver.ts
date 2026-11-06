import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { AuthenticationMethod as AuthenticationMethodType } from '@vendure/common/lib/generated-types';

import { idsAreEqual } from '../../../common/utils';
import { NATIVE_AUTH_STRATEGY_NAME } from '../../../config/auth/native-authentication-strategy';
import { AuthenticationMethod } from '../../../entity/authentication-method/authentication-method.entity';
import { ExternalAuthenticationMethod } from '../../../entity/authentication-method/external-authentication-method.entity';
import { RoleAssignment } from '../../../entity/role-assignment/role-assignment.entity';
import { Role } from '../../../entity/role/role.entity';
import { User } from '../../../entity/user/user.entity';
import { RoleAssignmentService } from '../../../service/services/role-assignment.service';
import { RoleService } from '../../../service/services/role.service';
import { UserService } from '../../../service/services/user.service';
import { RequestContext } from '../../common/request-context';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver('User')
export class UserEntityResolver {
    constructor(
        private userService: UserService,
        private roleAssignmentService: RoleAssignmentService,
        private roleService: RoleService,
    ) {}

    @ResolveField()
    async authenticationMethods(
        @Ctx() ctx: RequestContext,
        @Parent() user: User,
    ): Promise<AuthenticationMethodType[]> {
        let methodEntities: AuthenticationMethod[] = [];
        if (user.authenticationMethods) {
            methodEntities = user.authenticationMethods;
        }
        methodEntities = await this.userService
            .getUserById(ctx, user.id)
            .then(u => u?.authenticationMethods ?? []);

        return methodEntities.map(m => ({
            ...m,
            id: m.id.toString(),
            strategy: m instanceof ExternalAuthenticationMethod ? m.strategy : NATIVE_AUTH_STRATEGY_NAME,
        }));
    }

    @ResolveField()
    async roles(@Ctx() ctx: RequestContext, @Parent() user: User): Promise<Role[]> {
        const roles = await this.roleAssignmentService.resolveUserRoles(ctx, user.id);
        // The Roles are read from the User's assignments, which do not pass through the
        // RoleService read gate, so the visibility check is applied here (GHSA-37j3-p93w-fq6w).
        const visibleRoleIds = await this.roleService.getVisibleRoleIds(ctx);
        return roles.filter(role => visibleRoleIds.some(id => idsAreEqual(id, role.id)));
    }
}

@Resolver('User')
export class UserAdminEntityResolver {
    constructor(private roleAssignmentService: RoleAssignmentService) {}

    @ResolveField()
    async roleAssignments(@Ctx() ctx: RequestContext, @Parent() user: User): Promise<RoleAssignment[]> {
        return this.roleAssignmentService.getGrantableAssignmentsForUser(ctx, user.id);
    }
}
