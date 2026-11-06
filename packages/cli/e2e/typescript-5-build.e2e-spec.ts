/**
 * E2E test for `vendure build` in a project that stays on TypeScript 5.x.
 *
 * The fixture is a private workspace package (see the root package.json) that depends on
 * typescript@5.8.2. As the repo root depends on TypeScript 7, the package manager installs
 * TypeScript 5 nested in the fixture's own node_modules, so `vendure build` finds and runs it
 * exactly as it would in a user's project. Its tsconfig uses `baseUrl`, `moduleResolution: "node"`
 * and no `rootDir`, which TypeScript 5.x accepts but TypeScript 7 rejects.
 *
 * Requires the CLI to be built.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const cliPath = path.join(__dirname, '..', 'dist', 'cli.js');
const projectDir = path.join(__dirname, 'fixtures', 'ts5-project');
const distDir = path.join(projectDir, 'dist');

describe('vendure build with TypeScript 5.x', () => {
    beforeAll(() => {
        if (!existsSync(cliPath)) {
            throw new Error('The CLI must be built before running these tests (npm run build)');
        }
        const typescriptPackageJson = path.join(projectDir, 'node_modules', 'typescript', 'package.json');
        if (!existsSync(typescriptPackageJson)) {
            throw new Error(
                `The fixture's TypeScript 5 is not installed. Run "bun install" in the repo root.`,
            );
        }
        const { version } = JSON.parse(readFileSync(typescriptPackageJson, 'utf-8')) as { version: string };
        expect(version).toMatch(/^5\./);
    });

    afterEach(() => {
        rmSync(distDir, { recursive: true, force: true });
    });

    it("builds the server with the project's own TypeScript 5, skipping the TypeScript 7 tsconfig checks", () => {
        rmSync(distDir, { recursive: true, force: true });

        const result = spawnSync(process.execPath, [cliPath, 'build', 'server', '--no-progress'], {
            cwd: projectDir,
            encoding: 'utf-8',
        });
        const output = result.stdout + result.stderr;

        expect(output).not.toContain('not compatible with TypeScript 7');
        expect(result.status).toBe(0);
        expect(output).toContain(
            'Your project compiles with TypeScript 5.8.2, so the TypeScript 7 tsconfig checks are skipped',
        );
        // TypeScript 7 would have rejected this tsconfig (TS5102, TS5108, TS5011), so the
        // emitted output also shows that TypeScript 5 compiled the project.
        const indexJs = readFileSync(path.join(distDir, 'index.js'), 'utf-8');
        expect(indexJs).toContain('GreetingService');
        expect(indexJs).toContain('__decorate');
        expect(existsSync(path.join(distDir, 'shared', 'greeting.js'))).toBe(true);
    });
});
