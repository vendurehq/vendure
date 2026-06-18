import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { AuthenticationMethod as AuthenticationMethodType } from '@vendure/common/lib/generated-types';

import { NATIVE_AUTH_STRATEGY_NAME } from '../../../config/auth/native-authentication-strategy';
import { AuthenticationMethod } from '../../../entity/authentication-method/authentication-method.entity';
import { ExternalAuthenticationMethod } from '../../../entity/authentication-method/external-authentication-method.entity';
import { Role } from '../../../entity/role/role.entity';
import { User } from '../../../entity/user/user.entity';
import { UserService } from '../../../service/services/user.service';
import { RequestContext } from '../../common/request-context';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver('User')
export class UserEntityResolver {
    constructor(private userService: UserService) {}

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
        if (user.roles) {
            return user.roles;
        }
        let roles: Role[] = [];
        roles = await this.userService.getUserById(ctx, user.id).then(u => u?.roles ?? []);
        return roles;
    }
}
