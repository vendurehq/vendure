import { CommandContext, CommandPlan } from '@vendure/common/lib/command';

import { planConsoleChange } from './console-context.js';
import { DirInput } from './console.schema.js';

/**
 * Names the link an unlink would remove. Removing a manifest, valid or not, needs the `removeLink`
 * consent, whose digest covers the link it names. A project that is not linked needs none.
 */
export async function plan(input: DirInput, ctx: CommandContext): Promise<CommandPlan> {
    return planConsoleChange('unlink', input, ctx);
}
