import { CommandContext, fail } from '@vendure/common/lib/command';

import { logout } from '../../auth/auth-session.js';
import { clearPendingLogin } from '../../auth/pending-login.js';

import { authErrors } from './auth.errors.js';
import { AuthCommandDependencies, errorMessage } from './auth.js';
import { LogoutOutput } from './auth.schema.js';

/** Ends the session and removes the login, and any login still waiting for approval, from this machine. */
export function run(_input: Record<string, never>, ctx: CommandContext) {
    return runLogout(ctx);
}

export async function runLogout(ctx: CommandContext, dependencies: AuthCommandDependencies = {}) {
    const options = { ...dependencies, signal: ctx.signal };
    try {
        clearPendingLogin(options);
        const result = await logout(options);
        if (result.removed && !result.sessionEnded) {
            ctx.notice(
                'warning',
                'Vendure Console could not end the session, so a copy of this login keeps working until it expires.',
            );
        }
        return result;
    } catch (error) {
        return fail(authErrors.logoutFailed, { message: errorMessage(error, 'The logout failed.') });
    }
}

export function render(result: LogoutOutput): string {
    if (!result.removed) {
        return 'Not logged in.';
    }
    return result.sessionEnded
        ? 'Logged out. The session was ended and the login removed from this machine.'
        : 'Logged out. The login was removed from this machine.';
}
