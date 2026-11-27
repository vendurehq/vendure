import { CommandContext, CommandPlan, ErrorResult } from '@vendure/common/lib/command';

import { planConsoleChange, projectIsDirectory } from './console-context.js';
import { LinkInput } from './console.schema.js';

/**
 * Names the link a run would replace, if any. Replacing a valid link with another Console Project
 * needs the `replaceLink` consent, and so does a link the CLI cannot compare or a manifest it
 * cannot read. Its digest covers the current link and the requested Project, so a consent given
 * for one replacement never applies to another.
 */
export async function plan(input: LinkInput, ctx: CommandContext): Promise<CommandPlan | ErrorResult> {
    const refused = projectIsDirectory(input, ctx.cwd);
    if (refused) {
        return refused;
    }
    return planConsoleChange('link', input, ctx);
}
