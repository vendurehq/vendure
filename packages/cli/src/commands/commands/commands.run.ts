import type { CommandContext } from '@vendure/common/lib/command';

import { loadProjectCommands } from '../../command-host/manifest.js';

/**
 * The merged manifest for the current project: the CLI's own commands and those of its enabled
 * plugins, and the plugins whose commands were refused.
 */
export async function run(_input: Record<string, never>, ctx: CommandContext) {
    const { commands, refused } = await loadProjectCommands({ pluginOptions: { cwd: ctx.cwd } });
    for (const { package: packageName, error } of refused) {
        ctx.notice(
            'warning',
            `The commands of ${packageName} are not loaded: [${error.code}] ${error.message}`,
        );
    }
    return { commands, ...(refused.length ? { refused } : {}) };
}
