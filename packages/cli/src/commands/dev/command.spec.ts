import { log } from '@clack/prompts';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCli } from '../../shared/__tests__/run-cli';

import { devCommandDef } from './command';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('../../shared/cli-process-utils', async importOriginal => ({
    ...(await importOriginal<typeof import('../../shared/cli-process-utils')>()),
    resolvePackageBin: () => '/fake/bin.js',
}));

describe('dev project selection through the command definition', () => {
    let dir: string;
    let serverDir: string;

    beforeEach(() => {
        dir = mkdtempSync(path.join(tmpdir(), 'vendure-dev-command-'));
        serverDir = path.join(dir, 'server');
        mkdirSync(path.join(serverDir, 'src'), { recursive: true });
        writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ workspaces: ['server'] }));
        writeFileSync(
            path.join(serverDir, 'package.json'),
            JSON.stringify({ dependencies: { '@vendure/core': '3.6.0' } }),
        );
        writeFileSync(path.join(serverDir, 'src/index.ts'), '');
        writeFileSync(path.join(serverDir, 'src/index-worker.ts'), '');
        vi.spyOn(process, 'cwd').mockReturnValue(dir);
        vi.mocked(spawn).mockImplementation(() => {
            const child = Object.assign(new EventEmitter(), {
                exitCode: null,
                signalCode: null,
                stdout: null,
                stderr: null,
                kill: () => {
                    child.emit('close', 0, null);
                    return true;
                },
            });
            setTimeout(() => child.emit('close', 0, null), 0);
            return child as ReturnType<typeof spawn>;
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.mocked(spawn).mockReset();
        rmSync(dir, { recursive: true, force: true });
    });

    it.each([
        { args: [], count: 3 },
        { args: ['server'], count: 1 },
        { args: ['--project', 'server'], count: 3 },
        { args: ['server', '--project', 'server'], count: 1 },
    ])('starts the selected processes from the workspace member with $args', async ({ args, count }) => {
        const result = await runCli(
            [devCommandDef],
            [],
            ['dev', ...args, '--no-reload'],
            undefined,
            () => undefined,
        );
        expect(result.exitCode).toBe(0);
        expect(spawn).toHaveBeenCalledTimes(count);
        for (const call of vi.mocked(spawn).mock.calls) {
            expect(call[2]?.cwd).toBe(serverDir);
        }
    });

    it('starts from inside the server directory', async () => {
        vi.spyOn(process, 'cwd').mockReturnValue(serverDir);
        const result = await runCli([devCommandDef], [], ['dev', 'server', '--no-reload']);
        expect(result.exitCode).toBe(0);
        expect(vi.mocked(spawn).mock.calls[0][2]?.cwd).toBe(serverDir);
    });

    it('reports workspace ambiguity before starting a process', async () => {
        const otherDir = path.join(dir, 'other');
        mkdirSync(otherDir);
        writeFileSync(
            path.join(otherDir, 'package.json'),
            JSON.stringify({ dependencies: { '@vendure/core': '3.6.0' } }),
        );
        writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ workspaces: ['server', 'other'] }));
        const error = vi.spyOn(log, 'error').mockImplementation(() => undefined);
        const result = await runCli([devCommandDef], [], ['dev'], undefined, () => undefined);
        expect(result.exitCode).toBe(1);
        expect(error).toHaveBeenCalledWith(
            `Multiple Vendure projects found in "${dir}": other, server. Use --project <dir> to select one.`,
        );
        expect(spawn).not.toHaveBeenCalled();
    });

    it('reports no project instead of a missing entry file', async () => {
        rmSync(serverDir, { recursive: true });
        const error = vi.spyOn(log, 'error').mockImplementation(() => undefined);
        const result = await runCli([devCommandDef], [], ['dev'], undefined, () => undefined);
        expect(result.exitCode).toBe(1);
        expect(error).toHaveBeenCalledWith(
            `No Vendure project found in "${dir}". Use --project <dir> to select a project directory.`,
        );
        expect(spawn).not.toHaveBeenCalled();
    });

    it('reports an invalid --project before starting a process', async () => {
        const error = vi.spyOn(log, 'error').mockImplementation(() => undefined);
        const result = await runCli(
            [devCommandDef],
            [],
            ['dev', '--project', 'missing'],
            undefined,
            () => undefined,
        );
        expect(result.exitCode).toBe(1);
        expect(error).toHaveBeenCalledWith(
            expect.stringContaining(`Invalid --project directory "${path.join(dir, 'missing')}"`),
        );
        expect(spawn).not.toHaveBeenCalled();
    });
});
