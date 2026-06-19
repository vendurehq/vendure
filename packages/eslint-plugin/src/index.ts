import { noProcessEnvInPlugin } from './rules/no-process-env-in-plugin';
import { noRawRequestContextInJobData } from './rules/no-raw-request-context-in-job-data';
import { noStaticPluginOptionsOutsidePlugin } from './rules/no-static-plugin-options-outside-plugin';
import { noSynchronizeTrue } from './rules/no-synchronize-true';
import { requireJobQueueLifecycleRegistration } from './rules/require-job-queue-lifecycle-registration';
import { requirePluginCompatibility } from './rules/require-plugin-compatibility';
import { useTransactionalConnectionWithCtx } from './rules/use-transactional-connection-with-ctx';
import { VendurePlugin } from './types';

const plugin = {
    rules: {
        'no-process-env-in-plugin': noProcessEnvInPlugin,
        'no-synchronize-true': noSynchronizeTrue,
        'require-plugin-compatibility': requirePluginCompatibility,
        'no-static-plugin-options-outside-plugin': noStaticPluginOptionsOutsidePlugin,
        'use-transactional-connection-with-ctx': useTransactionalConnectionWithCtx,
        'require-job-queue-lifecycle-registration': requireJobQueueLifecycleRegistration,
        'no-raw-request-context-in-job-data': noRawRequestContextInJobData,
    },
    configs: {
        recommended: [] as any[],
    },
} satisfies VendurePlugin;

plugin.configs.recommended = [
    {
        files: ['**/src/**/*.ts'],
        plugins: {
            vendure: plugin,
        },
        rules: {
            'vendure/no-synchronize-true': 'error',
            'vendure/require-plugin-compatibility': 'error',
            'vendure/no-static-plugin-options-outside-plugin': 'error',
            'vendure/use-transactional-connection-with-ctx': 'warn',
            'vendure/require-job-queue-lifecycle-registration': 'warn',
            'vendure/no-raw-request-context-in-job-data': 'warn',
        },
    },
    {
        files: ['**/src/plugins/**/*.ts'],
        plugins: {
            vendure: plugin,
        },
        rules: {
            'vendure/no-process-env-in-plugin': 'error',
        },
    },
];

export = plugin;
