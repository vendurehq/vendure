import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCommandInHarness } from '../../command-host/__tests__/command-harness.js';

import { devDefinition } from './dev.command.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('../../shared/cli-process-utils.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../../shared/cli-process-utils.js')>()),
    resolvePackageBin: () => '/fake/bin.js',
}));

/**
 * Runs `vendure dev` through the command host with the real run and supervisor, and fake processes
 * that end at once, in a workspace whose member is the Vendure project.
 */
describe('vendure dev through the command host', () => {
    let dir: string;
    let serverDir: string;

    beforeEach(() => {
        dir = mkdtempSync(path.join(tmpdir(), 'vendure-dev-host-'));
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
            return child as unknown as ReturnType<typeof spawn>;
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.mocked(spawn).mockReset();
        rmSync(dir, { recursive: true, force: true });
    });

    it.each([
        { input: {}, count: 3 },
        { input: { target: 'server' }, count: 1 },
        { input: { dir: 'server' }, count: 3 },
        { input: { target: 'server', dir: 'server' }, count: 1 },
    ])('starts the selected processes from the workspace member with $input', async ({ input, count }) => {
        const result = await runCommandInHarness(devDefinition, { ...input, reload: false });

        expect(result.envelope.status).toBe('ok');
        expect(spawn).toHaveBeenCalledTimes(count);
        for (const call of vi.mocked(spawn).mock.calls) {
            expect(call[2]?.cwd).toBe(serverDir);
        }
    });

    it('names --dir when the directory is not a Vendure project, and starts nothing', async () => {
        const result = await runCommandInHarness(devDefinition, { dir: 'missing', reload: false });

        expect(result.envelope.error).toMatchObject({
            code: 'dev.start-failed',
            message: expect.stringContaining(`Invalid --dir directory "${path.join(dir, 'missing')}"`),
        });
        expect(spawn).not.toHaveBeenCalled();
    });
});
