import { CommandContext } from '@vendure/common/lib/command';

import { waitForPendingLogin } from '../../auth/pending-login.js';

import {
    AuthCommandDependencies,
    describeLoggedIn,
    invalidConsoleApi,
    keptBrowserChoiceNotice,
    loginError,
    organizationChooser,
    toLoggedIn,
} from './auth.js';
import { LoginOutput } from './auth.schema.js';

/** A tool call must answer well before an MCP client gives up on it. */
const DEFAULT_MCP_TIMEOUT_SECONDS = 30;

/**
 * Finishes the login that `vendure auth login --json` started. Returns the login once the code is
 * approved, or the pending login again when the timeout passes first, so the caller can wait again.
 * Without `--timeout`, it waits for the rest of the code lifetime, or 30 seconds as an MCP tool.
 */
export function run(input: { timeout?: number }, ctx: CommandContext) {
    return runWait(input, ctx);
}

export async function runWait(
    input: { timeout?: number },
    ctx: CommandContext,
    dependencies: AuthCommandDependencies & {
        sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    } = {},
) {
    const options = { ...dependencies, signal: ctx.signal };
    const invalid = invalidConsoleApi(options);
    if (invalid) {
        return invalid;
    }
    const timeoutSeconds = input.timeout ?? (ctx.mcp ? DEFAULT_MCP_TIMEOUT_SECONDS : undefined);
    let keptBrowserChoice = false;
    try {
        const result = await waitForPendingLogin({
            ...options,
            // The poll stops when the code expires, so no timeout means the rest of its lifetime.
            timeoutMs: timeoutSeconds === undefined ? Number.POSITIVE_INFINITY : timeoutSeconds * 1000,
            chooseOrganization: organizationChooser(ctx, () => (keptBrowserChoice = true)),
        });
        if ('status' in result) {
            ctx.notice(
                'info',
                'The code is not approved yet. Run `vendure auth wait` again to keep waiting.',
            );
            return result;
        }
        if (keptBrowserChoice) {
            ctx.notice('info', keptBrowserChoiceNotice(result));
        }
        return toLoggedIn(result);
    } catch (error) {
        return loginError(error);
    }
}

export function render(output: LoginOutput): string {
    if ('status' in output) {
        return (
            `The code ${output.code} is not approved yet. It expires at ${output.expiresAt}.\n` +
            `Open ${output.url} to approve it, then run \`vendure auth wait\` again.`
        );
    }
    return describeLoggedIn(output);
}
