import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { compile } from '../utils/compiler.js';
import { debugLogger, noopLogger } from '../utils/logger.js';

describe('detecting plugins in barrel exports', () => {
    it('should detect plugins in barrel exports', { timeout: 60_000 }, async () => {
        const tempDir = join(__dirname, './__temp/barrel-exports');
        await rm(tempDir, { recursive: true, force: true });
        const result = await compile({
            outputPath: tempDir,
            vendureConfigPath: join(__dirname, 'fixtures-barrel-exports', 'vendure-config.ts'),
            logger: process.env.LOG ? debugLogger : noopLogger,
        });

        expect(result.pluginInfo).toHaveLength(1);
        expect(result.pluginInfo[0].name).toBe('MyPlugin');
        expect(result.pluginInfo[0].dashboardEntryPath).toBe('./dashboard/index.tsx');
        expect(result.pluginInfo[0].sourcePluginPath).toBe(
            join(__dirname, 'fixtures-barrel-exports', 'my-plugin', 'src', 'my.plugin.ts'),
        );
        expect(result.pluginInfo[0].pluginPath).toBe(join(tempDir, 'my-plugin', 'src', 'my.plugin.js'));
    });
});
