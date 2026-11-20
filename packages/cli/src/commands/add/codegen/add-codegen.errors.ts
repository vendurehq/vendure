import { defineError } from '@vendure/common/lib/command';

export const pluginNotFound = defineError<{ plugin: string; available: string[] }>({
    code: 'add.plugin-not-found',
    exit: 1,
    message: ({ plugin, available }) =>
        `Plugin "${plugin}" not found. Available plugins: ${available.join(', ') || 'none'}.`,
});

export const packageJsonNotFound = defineError<Record<string, never>>({
    code: 'add.package-json-not-found',
    exit: 1,
    message: () => 'Could not locate a package.json file with a dependency on Vendure.',
});
