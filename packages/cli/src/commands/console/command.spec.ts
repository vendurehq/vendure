import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runCli } from '../../shared/__tests__/run-cli';

import { consoleCommandDef } from './command';

describe('console command definition', () => {
    // Every other test calls `consoleCommand` directly, so the flags the person
    // actually types were reachable only through this file.
    it.each(['--project <path>', '--force', '--yes'])('registers %s', flag => {
        expect(consoleCommandDef.options?.map(option => option.long)).toContain(flag);
    });

    it('does not register the removed --allow-custom-console option', () => {
        expect(consoleCommandDef.options?.map(option => option.long)).not.toContain('--allow-custom-console');
    });

    it('takes the action as an optional argument', () => {
        expect(consoleCommandDef.arguments?.[0]).toMatchObject({ name: 'action', required: false });
    });

    it('describes --force as creating a different link or removing the current one', () => {
        expect(consoleCommandDef.options?.find(option => option.long === '--force')?.description).toBe(
            'Create a different Project Link or remove the current link without confirmation',
        );
    });

    it('describes --yes as answering every CLI confirmation', () => {
        expect(consoleCommandDef.options?.find(option => option.long === '--yes')?.description).toBe(
            'Answer every CLI confirmation. Plugin hooks can still ask their own questions.',
        );
    });
});

// PDEV-556 — `vendure console` must resolve the workspace member itself. The
// host gate only walks up from the working directory, so from the root of a
// `create` workspace it refused to run before `--project` was read.
describe('console command at a workspace root', () => {
    const directories: string[] = [];

    afterEach(() => {
        vi.restoreAllMocks();
        for (const directory of directories.splice(0)) {
            fs.removeSync(directory);
        }
    });

    function scaffold(): { root: string; server: string } {
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-console-')));
        directories.push(root);
        const server = path.join(root, 'apps', 'server');
        fs.ensureDirSync(server);
        fs.ensureDirSync(path.join(root, 'apps', 'storefront'));
        fs.writeJsonSync(path.join(root, 'package.json'), { private: true, workspaces: ['apps/*'] });
        fs.writeJsonSync(path.join(server, 'package.json'), {
            dependencies: { '@vendure/core': '*' },
            devDependencies: { '@vendure/cli': '*' },
        });
        return { root, server };
    }

    // The root has no direct Vendure dependency, which is what makes the gate
    // find no project there.
    const noProjectAtCwd = () => undefined;

    async function runStatus(cwd: string, args: string[] = []) {
        vi.spyOn(process, 'cwd').mockReturnValue(cwd);
        return runCli([consoleCommandDef], [], ['console', 'status', ...args], undefined, noProjectAtCwd);
    }

    it.each([
        ['without options', []],
        ['with --project', ['--project', 'apps/server']],
    ])('finds apps/server %s', async (_label, args) => {
        // apps/storefront has no Vendure dependency, so discovery finds one project.
        const { root, server } = scaffold();

        const run = await runStatus(root, args);

        expect(run.stderr).not.toContain('must be run from a Vendure project directory');
        expect(run.exitCode).toBe(0);
        expect(run.stdout).toContain(path.join(server, '.vendure', 'project.json'));
    });

    it('finds the project from its own directory', async () => {
        const { server } = scaffold();

        const run = await runStatus(server);

        expect(run.exitCode).toBe(0);
        expect(run.stdout).toContain(path.join(server, '.vendure', 'project.json'));
    });

    it('lists the projects and asks for --project when several exist', async () => {
        const { root } = scaffold();
        const second = path.join(root, 'apps', 'second');
        fs.ensureDirSync(second);
        fs.writeJsonSync(path.join(second, 'package.json'), { dependencies: { '@vendure/core': '*' } });

        const run = await runStatus(root);

        expect(run.exitCode).toBe(1);
        expect(run.stdout + run.stderr).toContain('Multiple Vendure projects were found');
        expect(run.stdout + run.stderr).toContain('--project <path>');
    });

    it('does not mark the command as needing a project in help', async () => {
        const { root } = scaffold();
        vi.spyOn(process, 'cwd').mockReturnValue(root);

        const run = await runCli([consoleCommandDef], [], ['--help'], undefined, noProjectAtCwd);

        expect(run.stdout).not.toContain('Requires a Vendure project');
    });
});
