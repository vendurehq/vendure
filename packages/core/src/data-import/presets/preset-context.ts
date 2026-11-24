import { INestApplicationContext } from '@nestjs/common';

import { RequestContext } from '../../api/common/request-context';
import { ConfigService } from '../../config/config.service';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { User } from '../../entity';
import { RequestContextService } from '../../service/helpers/request-context/request-context.service';
import { ChannelService } from '../../service/services/channel.service';

/**
 * Finds the SuperAdmin user named by `authOptions.superadminCredentials`.
 */
export function findSuperAdminUser(
    connection: TransactionalConnection,
    configService: ConfigService,
): Promise<User | null> {
    return connection.rawConnection.getRepository(User).findOne({
        where: { identifier: configService.authOptions.superadminCredentials.identifier },
    });
}

/**
 * Creates a RequestContext for the default Channel as the SuperAdmin. Throws when the SuperAdmin
 * user does not exist, before anything is written.
 */
export async function createSuperAdminContext(app: INestApplicationContext): Promise<RequestContext> {
    const configService = app.get(ConfigService);
    const superAdminUser = await findSuperAdminUser(app.get(TransactionalConnection), configService);
    if (!superAdminUser) {
        throw new Error(
            `There is no SuperAdmin user "${configService.authOptions.superadminCredentials.identifier}". ` +
                'Seeding runs as the SuperAdmin, which Vendure creates on its first start.',
        );
    }
    const channel = await app.get(ChannelService).getDefaultChannel();
    return app.get(RequestContextService).create({
        user: superAdminUser,
        apiType: 'admin',
        languageCode: channel.defaultLanguageCode,
        channelOrToken: channel,
    });
}
