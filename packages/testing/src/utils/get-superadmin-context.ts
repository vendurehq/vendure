import { INestApplicationContext } from '@nestjs/common';
import { ChannelService, ConfigService, RequestContext, TransactionalConnection, User } from '@vendure/core';

/**
 * @description
 * Creates a {@link RequestContext} configured for the default Channel with the activeUser set
 * as the superadmin user. Useful for populating data.
 *
 * @docsCategory testing
 */
export async function getSuperadminContext(app: INestApplicationContext): Promise<RequestContext> {
    const defaultChannel = await app.get(ChannelService).getDefaultChannel();
    const connection = app.get(TransactionalConnection);
    const configService = app.get(ConfigService);
    const { superadminCredentials } = configService.authOptions;
    const superAdminUser = await connection
        .getRepository(User)
        .findOneOrFail({ where: { identifier: superadminCredentials.identifier } });
    return new RequestContext({
        channel: defaultChannel,
        apiType: 'admin',
        isAuthorized: true,
        authorizedAsOwnerOnly: false,
        session: {
            id: '',
            token: '',
            expires: new Date(),
            cacheExpiry: 999999,
            user: {
                id: superAdminUser.id,
                identifier: superAdminUser.identifier,
                verified: true,
                channelPermissions: [],
            },
        },
    });
}
