import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { compile } from '../utils/compiler.js';
import { debugLogger, noopLogger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

// #4807 — a config or plugin which imports a .json file must still compile. The
// compiler copies the JSON into the output alongside the emitted .js files, so
// the require/import in the emitted config resolves.
describe('compiling a config which imports .json files', () => {
    async function compileFixture(module: 'commonjs' | 'esm') {
        const tempDir = join(__dirname, `./__temp/json-${module}`);
        await rm(tempDir, { recursive: true, force: true });
        const result = await compile({
            outputPath: tempDir,
            vendureConfigPath: join(__dirname, 'fixtures-json', 'vendure-config.ts'),
            logger: process.env.LOG ? debugLogger : noopLogger,
            module,
        });
        return { tempDir, result };
    }

    it('should load a config which imports JSON in commonjs mode', { timeout: 60_000 }, async () => {
        const { tempDir, result } = await compileFixture('commonjs');

        // The JSON imported directly by the config, and the one imported
        // transitively by the plugin, both have to reach the output.
        expect(JSON.parse(await readFile(join(tempDir, 'config-data.json'), 'utf-8'))).toEqual({
            foo: 'bar',
        });
        expect(
            JSON.parse(await readFile(join(tempDir, 'my-plugin', 'src', 'plugin-data.json'), 'utf-8')),
        ).toEqual({ sheetId: 'abc123' });

        // Reading the value back off the loaded config proves the emitted
        // require() resolved, rather than only that the file was copied.
        expect(result.vendureConfig.customFields?.Product?.[0].name).toBe('bar');
    });

    // #5330 — Node refuses to load a JSON module in ESM without `with { type: 'json' }`,
    // so the emitted imports must carry that attribute. The config is loaded in a
    // plain Node process, because Vitest's loader resolves JSON without the
    // attribute and would pass here while a real `module: 'esm'` project fails.
    it('should load a config which imports JSON in esm mode', { timeout: 60_000 }, async () => {
        const { tempDir } = await compileFixture('esm');

        expect(JSON.parse(await readFile(join(tempDir, 'config-data.json'), 'utf-8'))).toEqual({
            foo: 'bar',
        });
        expect(
            JSON.parse(await readFile(join(tempDir, 'my-plugin', 'src', 'plugin-data.json'), 'utf-8')),
        ).toEqual({ sheetId: 'abc123' });

        // An import which already has the attribute keeps exactly one.
        const emittedConfig = await readFile(join(tempDir, 'vendure-config.js'), 'utf-8');
        const attributedImport = emittedConfig
            .split('\n')
            .find(line => line.includes('attributed-data.json'));
        expect(attributedImport?.match(/type:/g)).toHaveLength(1);

        const script = [
            'const { config, reexportedData, attributedLabel } = await import(process.argv[1]);',
            'const [MyPlugin] = config.plugins;',
            'console.log(JSON.stringify([',
            '    config.customFields.Product[0].name,',
            '    MyPlugin.sheetId,',
            '    reexportedData.label,',
            '    attributedLabel,',
            ']));',
        ].join('\n');
        const { stdout } = await execFileAsync(process.execPath, [
            '--input-type=module',
            '-e',
            script,
            pathToFileURL(join(tempDir, 'vendure-config.js')).href,
        ]);
        expect(JSON.parse(stdout)).toEqual(['bar', 'abc123', 'reexported', 'attributed']);
    });
    // Skipping the package.json silently leaves the import in the emitted output, so
    // the config fails to load with a bare "Cannot find module". Say so up front.
    it('should warn when a package.json import is skipped', { timeout: 60_000 }, async () => {
        const tempDir = join(__dirname, './__temp/json-pkg-warn');
        await rm(tempDir, { recursive: true, force: true });
        const warnings: string[] = [];

        await compile({
            outputPath: tempDir,
            vendureConfigPath: join(__dirname, 'fixtures-json-pkg', 'vendure-config.ts'),
            logger: { ...noopLogger, warn: (message: string) => warnings.push(message) },
            module: 'commonjs',
        }).catch(() => undefined);

        const packageJsonWarning = warnings.find(w => w.includes('package.json'));
        expect(packageJsonWarning).toBeDefined();
        expect(packageJsonWarning).toContain(join('my-plugin', 'package.json'));
    });

    it('should not warn when package.json is imported only for types', { timeout: 60_000 }, async () => {
        const tempDir = join(__dirname, './__temp/json-pkg-types');
        await rm(tempDir, { recursive: true, force: true });
        const warnings: string[] = [];

        await compile({
            outputPath: tempDir,
            vendureConfigPath: join(__dirname, 'fixtures-json-pkg', 'type-only-vendure-config.ts'),
            logger: { ...noopLogger, warn: (message: string) => warnings.push(message) },
            module: 'commonjs',
        });

        expect(warnings.some(warning => warning.includes('package.json cannot be copied'))).toBe(false);
    });

    // A package.json reached through the import graph must not be copied. In a
    // nested directory its "type" field decides how the compiled .js files beside
    // it are loaded, so copying it makes those files fail to load.
    it('should not copy a package.json into the output', { timeout: 60_000 }, async () => {
        const tempDir = join(__dirname, './__temp/json-pkg');
        await rm(tempDir, { recursive: true, force: true });

        await compile({
            outputPath: tempDir,
            vendureConfigPath: join(__dirname, 'fixtures-json-pkg', 'vendure-config.ts'),
            logger: process.env.LOG ? debugLogger : noopLogger,
            module: 'commonjs',
        }).catch(() => undefined);

        await expect(readFile(join(tempDir, 'my-plugin', 'package.json'), 'utf-8')).rejects.toThrow();
        // The output root keeps the generated stub, not the project's own file.
        expect(JSON.parse(await readFile(join(tempDir, 'package.json'), 'utf-8'))).toEqual({
            type: 'commonjs',
            private: true,
        });
    });
});
