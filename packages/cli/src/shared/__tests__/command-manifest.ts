import type { CommandManifest } from '@vendure/common/lib/command/manifest';

/**
 * A command manifest for `packageName` that declares one read-only command per path, valid enough
 * for the CLI to read the command names from it.
 */
export function commandManifest(packageName: string, paths: string[][]): CommandManifest {
    return {
        manifestVersion: 1,
        package: packageName,
        version: '1.0.0',
        commands: paths.map(commandPath => ({
            path: commandPath,
            description: `The ${commandPath.join(' ')} command`,
            keywords: [],
            behavior: 'readonly',
            requires: {},
            consents: {},
            input: { type: 'object', properties: {} },
            cli: {},
            errors: [],
            examples: [],
            expose: { mcp: true },
            hasPlan: false,
        })),
    };
}
