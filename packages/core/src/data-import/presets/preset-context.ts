import { INestApplicationContext } from '@nestjs/common';

import { RequestContext } from '../../api/common/request-context';
import { ConfigService } from '../../config/config.service';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { User } from '../../entity';
import { RequestContextService } from '../../service/helpers/request-context/request-context.service';
import { ChannelService } from '../../service/services/channel.service';

/**
 * Creates a RequestContext for the default Channel as the SuperAdmin, as the Populator does.
 */
export async function createSuperAdminContext(app: INestApplicationContext): Promise<RequestContext> {
    const { superadminCredentials } = app.get(ConfigService).authOptions;
    const connection = app.get(TransactionalConnection);
    const superAdminUser = await connection.rawConnection.getRepository(User).findOne({
        where: { identifier: superadminCredentials.identifier },
    });
    const channel = await app.get(ChannelService).getDefaultChannel();
    return app.get(RequestContextService).create({
        user: superAdminUser ?? undefined,
        apiType: 'admin',
        languageCode: channel.defaultLanguageCode,
        channelOrToken: channel,
    });
}
