import { defineCommand } from '@vendure/common/lib/command';

import { hostErrors } from '../../command-host/host-errors.js';

import { consoleErrors } from './console.errors.js';

const keywords = ['console', 'link', 'project', 'manifest'];

export const consoleLinkDefinition = defineCommand({
    path: ['console', 'link'],
    description:
        'Link this Vendure project to a Vendure Console Project, and run the setup of the CLI plugins. Run again to repair a link',
    keywords: [...keywords, 'connect', 'setup', 'repair'],
    behavior: 'mutating',
    consents: {
        replaceLink:
            'Replace the Project Link of this project with another Console Project. The replaced link no longer attributes telemetry.',
    },
    schemas: async () => (await import('./console.schema.js')).link,
    errors: [
        consoleErrors.projectIsDirectory,
        consoleErrors.projectNotFound,
        consoleErrors.linkFailed,
        hostErrors.cancelled,
    ],
    cli: {
        flags: {
            project: { placeholder: 'id|slug' },
            organization: { placeholder: 'account' },
        },
    },
    examples: [
        'vendure console link',
        'vendure console link --project storefront',
        'vendure console link --dir apps/server --project storefront --json',
    ],
    plan: () => import('./console-link.plan.js'),
    run: () => import('./console-link.run.js'),
    render: () => import('./console-link.render.js'),
});

export const consoleStatusDefinition = defineCommand({
    path: ['console', 'status'],
    description:
        'Show the Console Project this Vendure project is linked to. `vendure auth status` shows the login',
    keywords: [...keywords, 'whoami', 'telemetry'],
    behavior: 'readonly',
    schemas: async () => (await import('./console.schema.js')).status,
    errors: [consoleErrors.projectNotFound, consoleErrors.manifestInvalid, consoleErrors.statusFailed],
    examples: ['vendure console status', 'vendure console status --dir apps/server --json'],
    run: () => import('./console-status.run.js'),
    render: () => import('./console-status.run.js'),
});

export const consoleUnlinkDefinition = defineCommand({
    path: ['console', 'unlink'],
    description:
        'Remove the Project Link Manifest of this project. The Console Project and the CLI login stay as they are',
    keywords: [...keywords, 'disconnect', 'remove'],
    behavior: 'mutating',
    consents: {
        removeLink:
            'Remove the Project Link Manifest of this project, and stop attributing its telemetry to the Console Project.',
    },
    schemas: async () => (await import('./console.schema.js')).unlink,
    errors: [consoleErrors.projectNotFound, consoleErrors.unlinkFailed, hostErrors.cancelled],
    examples: ['vendure console unlink', 'vendure console unlink --remove-link <digest> --json'],
    plan: () => import('./console-unlink.plan.js'),
    run: () => import('./console-unlink.run.js'),
    render: () => import('./console-unlink.run.js'),
});

/** The `vendure console` commands, in the order they are listed. */
export const consoleDefinitions = [consoleLinkDefinition, consoleStatusDefinition, consoleUnlinkDefinition];
