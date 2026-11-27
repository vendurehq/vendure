// Declares `doctor`, which @vendure/cli already has, beside a command of its own. The host refuses
// the whole package, so neither command is loaded.
import { defineCommand } from '@vendure/common/lib/command';

const schemas = async () => {
    const { z } = await import('zod');
    return { input: z.object({}), output: z.object({}) };
};
const run = async () => ({ run: async () => ({}) });

export const commands = [
    defineCommand({ path: ['doctor'], description: 'A second doctor', behavior: 'readonly', schemas, run }),
    defineCommand({
        path: ['clashing', 'hello'],
        description: 'Never loaded',
        behavior: 'readonly',
        schemas,
        run,
    }),
];
