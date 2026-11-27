import type { CommandContext } from '@vendure/common/lib/command';

import { loadProjectCommands } from '../../command-host/manifest.js';

/**
 * The merged manifest for the current project: the CLI's own commands and those of its enabled
 * plugins, and the plugins whose commands were refused. The CLI has already written each refusal
 * to stderr when it started, so they are only listed here.
 */
export async function run(_input: Record<string, never>, ctx: CommandContext) {
    const { commands, refused } = await loadProjectCommands({ pluginOptions: { cwd: ctx.cwd } });
    return { commands, ...(refused.length ? { refused } : {}) };
}
