import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { AuthenticationMethod as AuthenticationMethodType } from '@vendure/common/lib/generated-types';

import { idsAreEqual } from '../../../common/utils';
import { NATIVE_AUTH_STRATEGY_NAME } from '../../../config/auth/native-authentication-strategy';
import { AuthenticationMethod } from '../../../entity/authentication-method/authentication-method.entity';
import { ExternalAuthenticationMethod } from '../../../entity/authentication-method/external-authentication-method.entity';
import { Role } from '../../../entity/role/role.entity';
import { User } from '../../../entity/user/user.entity';
import { RoleService } from '../../../service/services/role.service';
import { UserService } from '../../../service/services/user.service';
import { RequestContext } from '../../common/request-context';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver('User')
export class UserEntityResolver {
    constructor(
        private userService: UserService,
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
        const roles =
            user.roles ?? (await this.userService.getUserById(ctx, user.id).then(u => u?.roles ?? []));
        // Neither the Roles preloaded on a parent entity nor the UserService fallback pass through
        // the RoleService, so the visibility check is applied here too.
        const visibleRoleIds = await this.roleService.getVisibleRoleIds(ctx);
        return roles.filter(role => visibleRoleIds.some(id => idsAreEqual(id, role.id)));
    }
}
