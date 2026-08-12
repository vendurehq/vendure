import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { compile } from '../utils/compiler.js';
import { debugLogger, noopLogger } from '../utils/logger.js';

describe('compiling plugins which import .tsx files', () => {
    for (const module of ['commonjs', 'esm'] as const) {
        it(`should transform JSX in ${module} mode`, { timeout: 60_000 }, async () => {
            const tempDir = join(__dirname, `./__temp/jsx-${module}`);
            await rm(tempDir, { recursive: true, force: true });

            const result = await compile({
                outputPath: tempDir,
                vendureConfigPath: join(__dirname, 'fixtures-jsx', 'vendure-config.ts'),
                logger: process.env.LOG ? debugLogger : noopLogger,
                module,
            });

            // Without a `jsx` compiler option, transpileModule emits the JSX
            // verbatim into the .js output with no diagnostic, and importing the
            // compiled config then fails with a misleading error.
            const emitted = await readFile(join(tempDir, 'my-plugin', 'src', 'invoice.js'), 'utf-8');
            expect(emitted).toContain('react/jsx-runtime');
            expect(emitted).not.toContain('<div');

            expect(result.pluginInfo).toHaveLength(1);
            expect(result.pluginInfo[0].name).toBe('MyPlugin');
        });
    }
});
