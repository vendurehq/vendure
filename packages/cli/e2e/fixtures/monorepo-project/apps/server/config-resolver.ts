// The project's own config resolver. The config is not declared in the app's source: a shared
// library builds it at run time, and the app imports it through a path mapping of the base tsconfig.
import { getVendureConfig } from '@example/shared-config';

export async function resolve(ctx: { configFile?: string }) {
    // A config file named with --config wins: returning undefined lets the CLI load it.
    if (ctx.configFile) {
        return undefined;
    }
    return getVendureConfig();
}
