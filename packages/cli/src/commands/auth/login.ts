import { CommandContext } from '@vendure/common/lib/command';

import { checkAuthStatus, readAuthStatus } from '../../auth/auth-session.js';
import { startPendingLogin } from '../../auth/pending-login.js';

import {
    AuthCommandDependencies,
    describeEmail,
    describeLoggedIn,
    describeRefusal,
    invalidConsoleApi,
    loginError,
    toLoggedIn,
} from './auth.js';
import { LoginOutput } from './auth.schema.js';
import { signInWithDevice } from './sign-in.js';

/**
 * Signs in with the device flow. A person at a terminal is shown the code, the browser opens,
 * and the command waits for approval, as `vendure auth login` always has. Anyone else gets the
 * URL and code at once, saved as the pending login that `vendure auth wait` finishes, so an
 * agent can hand them to a person without blocking.
 */
export function run(input: { organization?: string }, ctx: CommandContext) {
    return runLogin(input, ctx);
}

export async function runLogin(
    input: { organization?: string },
    ctx: CommandContext,
    dependencies: AuthCommandDependencies = {},
) {
    const options = { ...dependencies, signal: ctx.signal };
    const organization = input.organization?.trim() || undefined;
    const invalid = invalidConsoleApi(options);
    if (invalid) {
        return invalid;
    }
    if (!ctx.ask) {
        try {
            const pending = await startPendingLogin({ ...options, organization });
            const stored = readAuthStatus(options);
            if (stored.loggedIn) {
                ctx.notice(
                    'info',
                    `This machine is logged in as ${describeEmail(stored)}. ` +
                        'That login stays until this one is approved, which replaces it.',
                );
            }
            ctx.notice(
                'info',
                'Ask a person to open the URL and confirm the code, then run `vendure auth wait` to finish the login.',
            );
            return pending;
        } catch (error) {
            return loginError(error);
        }
    }

    // A person is at the terminal. A login that can still be renewed is replaced only when they confirm.
    if (readAuthStatus(options).loggedIn) {
        const existing = await checkAuthStatus(options);
        if (existing.renewable === false) {
            ctx.notice('warning', describeRefusal(existing, 'Signing in again.'));
        } else if (existing.loggedIn) {
            if (existing.renewalError) {
                ctx.notice(
                    'warning',
                    `Could not check that the stored login can be renewed: ${existing.renewalError.message}`,
                );
            }
            const replace = await ctx.ask.confirm(
                `Already logged in as ${describeEmail(existing)}. Sign in again?`,
            );
            if (replace !== true) {
                ctx.notice('info', 'Kept the stored login.');
                return toLoggedIn(existing);
            }
        }
    }

    try {
        return toLoggedIn(
            await signInWithDevice(ctx, { ...options, organization, openUrl: dependencies.openUrl }),
        );
    } catch (error) {
        return loginError(error);
    }
}

export function render(output: LoginOutput): string {
    if ('status' in output) {
        return (
            `Open ${output.url} and confirm the code ${output.code} before ${output.expiresAt}.\n` +
            'Then run `vendure auth wait` to finish the login.'
        );
    }
    return describeLoggedIn(output);
}
