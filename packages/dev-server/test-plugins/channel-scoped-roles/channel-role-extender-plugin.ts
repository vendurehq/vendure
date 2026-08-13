import { Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import {
    Administrator,
    Allow,
    ChannelRoleService,
    Ctx,
    PermissionDefinition,
    PluginCommonModule,
    RequestContext,
    RoleService,
    TransactionalConnection,
    VendurePlugin,
} from '@vendure/core';
import gql from 'graphql-tag';

/**
 * A plugin-defined permission. It must be grantable through a channel-scoped Role assignment just like
 * a built-in one, and must not leak to other channels.
 */
export const auditPermission = new PermissionDefinition({
    name: 'ChannelAudit',
    description: 'Grants permission to run the channel audit',
});

@Resolver()
class ChannelAuditResolver {
    constructor(private roleService: RoleService) {}

    /**
     * Gated on the custom permission. Should succeed only on channels where the caller was granted a Role
     * carrying `ChannelAudit`.
     */
    @Query()
    @Allow(auditPermission.Permission)
    async runChannelAudit(@Ctx() ctx: RequestContext) {
        return {
            channelCode: ctx.channel.code,
            // Cross-checks the request-scoped session against the DB-side per-channel lookup. These two
            // paths are computed separately, so a mismatch means the merge is inconsistent.
            grantedViaSession: ctx.userHasPermissions([auditPermission.Permission]),
            grantedViaDatabase: await this.roleService.userHasPermissionOnChannel(
                ctx,
                ctx.channelId,
                auditPermission.Permission,
            ),
        };
    }
}

/**
 * Extends the `Administrator` type alongside the new `channelRoles` field, to confirm plugin field
 * resolvers still compose with it.
 */
@Resolver('Administrator')
class AdministratorAuditEntityResolver {
    constructor(
        private channelRoleService: ChannelRoleService,
        private connection: TransactionalConnection,
    ) {}

    @ResolveField()
    async channelRoleSummary(
        @Ctx() ctx: RequestContext,
        @Parent() administrator: Administrator,
    ): Promise<string> {
        // `administrator.user` is only loaded when the GraphQL selection set asks for it, since Vendure
        // derives the relations to join from the query. A field resolver must not assume it is present.
        const userId =
            administrator.user?.id ??
            (
                await this.connection.getEntityOrThrow(ctx, Administrator, administrator.id, {
                    relations: { user: true },
                })
            ).user.id;
        const channelRoles = await this.channelRoleService.findByUserId(ctx, userId);
        if (!channelRoles.length) {
            return 'no channel-scoped roles';
        }
        return channelRoles.map(cr => `${cr.role.code}@${cr.channel.code}`).join(', ');
    }
}

@VendurePlugin({
    imports: [PluginCommonModule],
    adminApiExtensions: {
        schema: gql`
            type ChannelAuditResult {
                channelCode: String!
                grantedViaSession: Boolean!
                grantedViaDatabase: Boolean!
            }
            extend type Query {
                runChannelAudit: ChannelAuditResult!
            }
            extend type Administrator {
                channelRoleSummary: String!
            }
        `,
        resolvers: [ChannelAuditResolver, AdministratorAuditEntityResolver],
    },
    configuration: config => {
        config.authOptions.customPermissions.push(auditPermission);
        return config;
    },
})
export class ChannelRoleExtenderPlugin {}
