import { VendurePlugin } from '@vendure/core';

import { config as workingConfig } from './vendure-config';

/** Fails while Vendure starts, so seed-command.e2e-spec.ts can tell whether a run bootstrapped. */
@VendurePlugin({})
class BrokenPlugin {
    onModuleInit() {
        throw new Error('The broken plugin failed to start');
    }
}

export const config = { ...workingConfig, plugins: [BrokenPlugin] };
