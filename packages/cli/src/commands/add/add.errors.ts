import { defineError } from '@vendure/common/lib/command';

export const pluginNotFound = defineError<{ plugin: string; available: string[] }>({
    code: 'add.plugin-not-found',
    exit: 1,
    message: ({ plugin, available }) =>
        `Plugin "${plugin}" not found. Available plugins: ${available.join(', ') || 'none'}.`,
});

export const pluginAmbiguous = defineError<{ plugin: string; files: string[] }>({
    code: 'add.plugin-ambiguous',
    exit: 1,
    message: ({ plugin, files }) =>
        `More than one plugin class is named "${plugin}": ${files.join(', ')}. Rename one of them.`,
});

export const packageJsonNotFound = defineError<Record<string, never>>({
    code: 'add.package-json-not-found',
    exit: 1,
    message: () => 'Could not locate a package.json file with a dependency on Vendure.',
});

export const serviceNotFound = defineError<{ service: string; plugin: string; available: string[] }>({
    code: 'add.service-not-found',
    exit: 1,
    message: ({ service, plugin, available }) =>
        available.length
            ? `Service "${service}" not found in plugin "${plugin}". Available services: ${available.join(', ')}.`
            : `Plugin "${plugin}" has no services. Create one first.`,
    fix: ({ plugin, available }) =>
        available.length
            ? []
            : [
                  {
                      path: ['add', 'service'],
                      input: { plugin },
                      description: 'Create a service in the plugin',
                  },
              ],
});

export const entityNotFound = defineError<{ entity: string; plugin: string; available: string[] }>({
    code: 'add.entity-not-found',
    exit: 1,
    message: ({ entity, plugin, available }) =>
        available.length
            ? `Entity "${entity}" not found in plugin "${plugin}". Available entities: ${available.join(', ')}.`
            : `Plugin "${plugin}" has no entities. Create one first.`,
    fix: ({ plugin, available }) =>
        available.length
            ? []
            : [{ path: ['add', 'entity'], input: { plugin }, description: 'Create an entity in the plugin' }],
});

export const fileExists = defineError<{ path: string }>({
    code: 'add.file-exists',
    exit: 1,
    message: ({ path }) => `"${path}" already exists. Choose another name.`,
});
