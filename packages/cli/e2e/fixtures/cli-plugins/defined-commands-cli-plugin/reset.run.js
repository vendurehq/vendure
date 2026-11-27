import { fail } from '@vendure/common/lib/command';
import fs from 'node:fs';
import path from 'node:path';

import { nothingToReset } from './commands.js';

export async function run(_input, ctx) {
    const file = path.join(ctx.cwd, 'example-data.json');
    if (!fs.existsSync(file)) {
        return fail(nothingToReset, { file });
    }
    fs.rmSync(file);
    return { deleted: file };
}
