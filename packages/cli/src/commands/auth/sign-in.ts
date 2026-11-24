import { CommandContext } from '@vendure/common/lib/command';

import { AuthOptions } from '../../auth/auth-options.js';
import { AuthStatus, loginWithDevice } from '../../auth/auth-session.js';
import { clearPendingLogin } from '../../auth/pending-login.js';
import { openConsoleBrowser } from '../console/authentication.js';

import { keptBrowserChoiceNotice, organizationChooser } from './auth.js';

/**
 * Signs a person in at the terminal with the device flow, as `vendure auth login` does: it shows
 * the code, opens the browser, waits for approval, and asks which organization to use when the
 * person has more than one. Call it only when `ctx.ask` is set.
 */
export async function signInWithDevice(
    ctx: CommandContext,
    options: AuthOptions & { organization?: string; openUrl?: (url: string) => Promise<void> } = {},
): Promise<AuthStatus> {
    let keptBrowserChoice = false;
    const openUrl = options.openUrl ?? openConsoleBrowser;
    const status = await loginWithDevice({
        ...options,
        signal: options.signal ?? ctx.signal,
        chooseOrganization: organizationChooser(ctx, () => (keptBrowserChoice = true)),
        onDeviceAuthorization: async device => {
            ctx.notice(
                'info',
                `Confirm this code in your browser: ${device.userCode}\n` +
                    `If the browser does not open, visit ${device.verificationUriComplete}`,
            );
            try {
                await openUrl(device.verificationUriComplete);
            } catch {
                // The URL is already on screen.
            }
            ctx.progress('Waiting for approval...');
        },
    });
    // A later `auth wait` must not finish an older code and replace this login.
    clearPendingLogin(options);
    if (keptBrowserChoice) {
        ctx.notice('info', keptBrowserChoiceNotice(status));
    }
    return status;
}
