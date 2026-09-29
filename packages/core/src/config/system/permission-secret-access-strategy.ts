import { Permission } from '@vendure/common/lib/generated-types';

import { RequestContext } from '../../api/common/request-context';

import { SecretAccessInput, SecretAccessStrategy } from './secret-access-strategy';

/**
 * @description
 * The default {@link SecretAccessStrategy}. Reading a secret's decrypted value requires the
 * `Permission.ReadSecret` permission (held by the SuperAdmin by default). Writing a secret is not
 * gated here — it is governed by the entity's own `Create`/`Update` permission.
 *
 * @since 3.8.0
 * @docsCategory configuration
 * @docsPage SecretAccessStrategy
 */
export class PermissionSecretAccessStrategy implements SecretAccessStrategy {
    canAccessSecret(ctx: RequestContext, input: SecretAccessInput): boolean {
        return ctx.userHasPermissions([Permission.ReadSecret]);
    }
}
