import { OnModuleInit } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';
import {
    Allow,
    ChannelRoleService,
    Ctx,
    EventBus,
    Logger,
    Permission,
    PluginCommonModule,
    RequestContext,
    RequestContextService,
    RoleChangeEvent,
    SessionService,
    TransactionalConnection,
    User,
    VendurePlugin,
} from '@vendure/core';
import gql from 'graphql-tag';

const loggerCtx = 'ChannelRoleConsumerPlugin';

/**
 * Consumes the *existing* authorization APIs, none of which changed shape when channel-scoped roles
 * were added. If any of these break, the feature has leaked into the public surface.
 */
@Resolver()
class ChannelRoleConsumerResolver {
    constructor(
        private connection: TransactionalConnection,
        private channelRoleService: ChannelRoleService,
        private requestContextService: RequestContextService,
        private sessionService: SessionService,
    ) {}

    /**
     * `@Allow` + `ctx.userHasPermissions()` must be satisfied by permissions which arrive via a
     * ChannelRole, exactly as if they had come from `User.roles`.
     */
    @Query()
    @Allow(Permission.ReadCatalog)
    consumerCheckPermissions(@Ctx() ctx: RequestContext) {
        return {
            channelCode: ctx.channel.code,
            // OR semantics
            canReadCatalog: ctx.userHasPermissions([Permission.ReadCatalog]),
            // AND semantics
            canReadAndUpdateCatalog: ctx.userHasAllPermissions([
                Permission.ReadCatalog,
                Permission.UpdateCatalog,
            ]),
            // Should never be true for a catalog-only role, on any channel
            canCreateAdministrator: ctx.userHasPermissions([Permission.CreateAdministrator]),
            // The flattened per-channel list every plugin reads
            channelsFromSession: (ctx.session?.user?.channelPermissions ?? []).map(c => c.code),
        };
    }

    /**
     * A synthetic RequestContext built outside the request cycle (jobs, scripts) must resolve the same
     * permissions, including those from ChannelRoles.
     */
    @Query()
    @Allow(Permission.ReadAdministrator)
    async consumerSyntheticContext(@Ctx() ctx: RequestContext, @Args() args: { userId: string }) {
        const user = await this.connection.getRepository(ctx, User).findOne({
            where: { id: args.userId },
            relations: { roles: { channels: true } },
        });
        if (!user) {
            return null;
        }
        const syntheticCtx = await this.requestContextService.create({ apiType: 'admin', user });
        return {
            identifier: user.identifier,
            // Comes from `User.roles` only
            directRoleCodes: user.roles.map(role => role.code),
            // Comes from the ChannelRole join
            channelRoleCodes: (await this.channelRoleService.findByUserId(ctx, user.id)).map(
                cr => cr.role.code,
            ),
            // The merge of both, as baked into a session
            resolvedChannels: (syntheticCtx.session?.user?.channelPermissions ?? []).map(c => c.code),
        };
    }

    /**
     * `serializeSession()` gained an optional second argument. Calling it with one argument, as any
     * existing plugin would, must still compile and behave.
     */
    @Query()
    @Allow(Permission.ReadAdministrator)
    async consumerSerializeSession(@Ctx() ctx: RequestContext) {
        const session = await this.sessionService.getSessionFromToken(ctx.session?.token ?? '');
        return {
            hasUser: !!session?.user,
            channelCount: session?.user?.channelPermissions.length ?? 0,
        };
    }
}

@VendurePlugin({
    imports: [PluginCommonModule],
    adminApiExtensions: {
        schema: gql`
            type ConsumerPermissionCheck {
                channelCode: String!
                canReadCatalog: Boolean!
                canReadAndUpdateCatalog: Boolean!
                canCreateAdministrator: Boolean!
                channelsFromSession: [String!]!
            }
            type ConsumerSyntheticContext {
                identifier: String!
                directRoleCodes: [String!]!
                channelRoleCodes: [String!]!
                resolvedChannels: [String!]!
            }
            type ConsumerSessionInfo {
                hasUser: Boolean!
                channelCount: Int!
            }
            extend type Query {
                consumerCheckPermissions: ConsumerPermissionCheck!
                consumerSyntheticContext(userId: ID!): ConsumerSyntheticContext
                consumerSerializeSession: ConsumerSessionInfo!
            }
        `,
        resolvers: [ChannelRoleConsumerResolver],
    },
})
export class ChannelRoleConsumerPlugin implements OnModuleInit {
    constructor(private eventBus: EventBus) {}

    /**
     * RoleChangeEvent kept its shape (no Channel dimension), and is still published when Roles are
     * granted or revoked via ChannelRoles, so existing subscribers do not go silent.
     */
    onModuleInit() {
        this.eventBus.ofType(RoleChangeEvent).subscribe(event => {
            Logger.info(
                `RoleChangeEvent: ${event.type} roleIds=[${event.roleIds.join(',')}] ` +
                    `admin=${event.admin.emailAddress}`,
                loggerCtx,
            );
        });
    }
}
