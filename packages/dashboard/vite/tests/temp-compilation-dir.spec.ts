import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { getDefaultTempCompilationDir, TEMP_COMPILATION_DIR_NAME } from '../utils/temp-compilation-dir.js';

describe('getDefaultTempCompilationDir', () => {
    it('resolves under the project node_modules/.cache', () => {
        const cwd = path.join(path.sep, 'tmp', 'my-project');

        const dir = getDefaultTempCompilationDir(cwd);

        expect(dir).toBe(path.join(cwd, 'node_modules', '.cache', TEMP_COMPILATION_DIR_NAME));
    });

    it('defaults to process.cwd() when no cwd is provided', () => {
        const dir = getDefaultTempCompilationDir();

        expect(dir).toBe(
            path.join(process.cwd(), 'node_modules', '.cache', TEMP_COMPILATION_DIR_NAME),
        );
    });
});
