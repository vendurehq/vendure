import path from 'node:path';

import { getTsMorphProject } from '../utilities/ast-utils.js';

/**
 * Opens the project in the current directory with ts-morph. Unlike `analyzeProject`, it prints
 * nothing, so a command's `run` can use it.
 */
export async function openProject() {
    const { project, tsConfigPath } = await getTsMorphProject({
        compilerOptions: {
            // The CLI wants the source files, not only the compiled .js files.
            rootDir: path.resolve('./src'),
        },
    });
    return { project, tsConfigPath };
}
