import { COMMAND_EXIT_CODES, defineError } from '@vendure/common/lib/command';
import { SUPER_ADMIN_USER_PASSWORD } from '@vendure/common/lib/shared-constants';

import { RequestContext } from '../../../api/common/request-context';
import { ConfigService } from '../../../config/config.service';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { NativeAuthenticationMethod } from '../../../entity/authentication-method/native-authentication-method.entity';
import { PasswordCipher } from '../password-cipher/password-cipher';

import { StoreReadinessFinding, StoreReadinessSeverity, toFinding } from './store-readiness-types';

export const defaultSuperadminPassword = defineError<{ identifier: string }>({
    code: 'store.auth.default-superadmin-password',
    exit: COMMAND_EXIT_CODES.failed,
    message: ({ identifier }) =>
        `The superadmin "${identifier}" still has the default password. Anyone who knows Vendure can sign in as it.`,
});

/**
 * The superadmin no longer has the default password. It is a warning, not an error, so a local store
 * that keeps the defaults can still be ready.
 */
export async function checkSuperadminCredentials(
    ctx: RequestContext,
    services: {
        connection: TransactionalConnection;
        configService: ConfigService;
        passwordCipher: PasswordCipher;
    },
): Promise<StoreReadinessFinding[]> {
    const { identifier } = services.configService.authOptions.superadminCredentials;
    const method = await services.connection
        .getRepository(ctx, NativeAuthenticationMethod)
        .createQueryBuilder('method')
        .addSelect('method.passwordHash')
        .innerJoin('method.user', 'user')
        .where('user.identifier = :identifier', { identifier })
        .andWhere('user.deletedAt IS NULL')
        .getOne();
    if (!method?.passwordHash) {
        return [];
    }
    const isDefault = await services.passwordCipher.check(SUPER_ADMIN_USER_PASSWORD, method.passwordHash);
    if (!isDefault) {
        return [];
    }
    return [
        toFinding(
            defaultSuperadminPassword,
            StoreReadinessSeverity.WARNING,
            { identifier },
            { dashboardUrl: '/administrators' },
        ),
    ];
}
