import { CommandContext, CommandPlan } from '@vendure/common/lib/command';

import { consoleDependencies, silentReporter } from './console-context.js';
import { previewConsoleChange } from './console.js';
import { DirInput } from './console.schema.js';

/**
 * Names the link an unlink would remove. Removing a manifest, valid or not, needs the `removeLink`
 * consent, whose digest covers the link it names. A project that is not linked needs none.
 */
export async function plan(input: DirInput, ctx: CommandContext): Promise<CommandPlan> {
    const { dependencies } = consoleDependencies(ctx);
    return previewConsoleChange('unlink', input, { ...dependencies, reporter: silentReporter });
}
