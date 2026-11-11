import { Injector, RequestContext } from '@vendure/core';

import { EmailPluginDevModeOptions, EmailPluginOptions, EmailTransportOptions } from './types';

export function isDevModeOptions(
    input: EmailPluginOptions | EmailPluginDevModeOptions,
): input is EmailPluginDevModeOptions {
    return (input as EmailPluginDevModeOptions).devMode === true;
}

export function getDevModeProductionWarning(
    options: EmailPluginOptions | EmailPluginDevModeOptions,
): string | undefined {
    if (!isDevModeOptions(options) || process.env.NODE_ENV !== 'production') {
        return undefined;
    }
    return (
        `devMode is enabled while NODE_ENV is "production". The dev mailbox at route "${options.route}" ` +
        'has no authentication. It renders and sends emails built from real database data, including ' +
        `customer names and addresses. Emails are written to "${options.outputPath}" and are not sent. ` +
        'Remove `devMode` and configure a `transport` for production.'
    );
}

export async function resolveTransportSettings(
    options: EmailPluginOptions | EmailPluginDevModeOptions,
    injector: Injector,
    ctx?: RequestContext,
): Promise<EmailTransportOptions> {
    const transport = (options as EmailPluginOptions).transport;
    return typeof transport === 'function' ? transport(injector, ctx) : transport;
}
