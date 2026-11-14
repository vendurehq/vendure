import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { analyzeProject } from './shared-prompts.js';

describe('analyzeProject()', () => {
    let projectDir: string;

    beforeEach(() => {
        projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-analyze-project-'));
        // The tmp dir may sit behind a symlink. ts-morph reports resolved paths.
        projectDir = fs.realpathSync(projectDir);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.removeSync(projectDir);
    });

    function writeProject(compilerOptions: Record<string, unknown>) {
        fs.writeJsonSync(path.join(projectDir, 'package.json'), {
            name: 'test-project',
            dependencies: { '@vendure/core': '3.0.0' },
        });
        fs.writeJsonSync(path.join(projectDir, 'tsconfig.json'), {
            compilerOptions: {
                target: 'es2022',
                module: 'commonjs',
                outDir: './dist',
                ...compilerOptions,
            },
            include: ['src'],
        });
        fs.ensureDirSync(path.join(projectDir, 'src'));
        fs.writeFileSync(path.join(projectDir, 'src', 'index.ts'), 'export const answer = 42;\n');
    }

    async function analyzeInProjectDir() {
        // process.chdir() is not available in vitest worker threads.
        vi.spyOn(process, 'cwd').mockReturnValue(projectDir);
        return analyzeProject({});
    }

    it('loads the source files of a project', async () => {
        writeProject({});

        const { project } = await analyzeInProjectDir();

        expect(project.getSourceFiles().map(f => f.getFilePath())).toContain(
            path.join(projectDir, 'src', 'index.ts'),
        );
    });

    // A relative rootDir made TypeScript throw "Paths must either both be absolute
    // or both be relative" when the project tsconfig has composite: true.
    it('loads the source files of a project with a composite tsconfig', async () => {
        writeProject({ composite: true });

        const { project } = await analyzeInProjectDir();

        expect(project.getSourceFiles().map(f => f.getFilePath())).toContain(
            path.join(projectDir, 'src', 'index.ts'),
        );
    });
});
