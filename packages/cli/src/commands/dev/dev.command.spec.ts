import { buildCommandManifest, mergeManifests } from '@vendure/common/lib/command/manifest';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runCommandInHarness } from '../../command-host/__tests__/command-harness.js';
import { collectFlagInput, registerManifestCommands } from '../../command-host/commander-adapter.js';
import { coreCommandDefinitions } from '../../command-host/core-commands.js';
import { isExposed, toolName } from '../../command-host/mcp/server.js';

import { devDefinition } from './dev.command.js';
import type { DevIo, RunDevOptions } from './dev.js';

const runDev = vi.hoisted(() => vi.fn());
vi.mock('./dev.js', () => ({ runDev }));

async function commandLine() {
    const built = await buildCommandManifest('@vendure/cli', '0.0.0', [devDefinition]);
    const root = new Command('vendure').exitOverride();
    registerManifestCommands(root, mergeManifests([built]), { loadDefinitions: async () => [devDefinition] });
    const dev = root.commands.find(command => command.name() === 'dev') as Command;
    dev.exitOverride();
    return { root, dev };
}

async function parse(args: string[]) {
    const { root, dev } = await commandLine();
    // Every field the manifest declares for `dev`, so a new one is parsed here too.
    const manifest = await buildCommandManifest('@vendure/cli', '0.0.0', [devDefinition]);
    const fields = Object.keys(manifest.commands[0].input.properties as object);
    let positional: Record<string, unknown> = {};
    dev.action((target: unknown) => {
        positional = { target };
    });
    await root.parseAsync(['dev', ...args], { from: 'user' });
    return collectFlagInput(dev, fields, positional);
}

describe('vendure dev on the command host', () => {
    beforeEach(() => {
        runDev.mockReset();
    });

    it('offers its options, with --dir for the project directory', async () => {
        const { dev } = await commandLine();
        const flags = dev.options.map(option => option.flags);
        expect(flags).toEqual(
            expect.arrayContaining([
                '--dir <dir>',
                '--server-entry <server-entry>',
                '--inspect [host:port]',
                '--inspect-brk [host:port]',
                '--reload',
                '--no-reload',
                '--reload-ignored-paths <reload-ignored-paths...>',
            ]),
        );
        expect(flags.some(flag => flag.includes('--project'))).toBe(false);
    });

    it('reads the target, --no-reload and an --inspect with or without a value', async () => {
        expect(await parse(['server', '--no-reload', '--inspect'])).toEqual({
            target: 'server',
            reload: false,
            inspect: true,
        });
        expect(await parse(['--inspect-brk', '0.0.0.0:9229', '--dir', 'apps/server'])).toEqual({
            inspectBrk: '0.0.0.0:9229',
            dir: 'apps/server',
        });
        expect(await parse(['--reload-ignored-paths', 'src/gql', 'generated'])).toEqual({
            reloadIgnoredPaths: ['src/gql', 'generated'],
        });
    });

    it('is not among the tools of the Developer MCP', async () => {
        const manifest = await buildCommandManifest('@vendure/cli', '0.0.0', coreCommandDefinitions);
        const tools = mergeManifests([manifest]).filter(isExposed).map(toolName);
        expect(tools).toContain('devserver_start');
        expect(tools).not.toContain('dev');
    });

    it('passes its input to the run, with the project directory and the signal', async () => {
        runDev.mockResolvedValue({ exitCode: 0, stopped: true });
        const signal = new AbortController().signal;
        const result = await runCommandInHarness(
            devDefinition,
            { target: 'server', dir: 'apps/server', reload: false },
            { signal },
        );

        expect(result.envelope).toMatchObject({
            status: 'ok',
            output: { processExitCode: 0, stopped: true },
        });
        const [target, options, runOptions] = runDev.mock.calls[0] as [string, object, RunDevOptions];
        expect(target).toBe('server');
        expect(options).toMatchObject({ project: 'apps/server', reload: false });
        expect(runOptions.signal).toBe(signal);
    });

    // The harness fails a run that writes to stdout or stderr itself.
    it('sends the output of its processes as events, and its messages as notices, never to stdout', async () => {
        runDev.mockImplementation(async (_target: string, _options: object, { io }: { io: DevIo }) => {
            io.write('stdout', '[server] listening\n');
            io.warn('Another run holds the state file');
            return { exitCode: 0, stopped: true };
        });
        const result = await runCommandInHarness(devDefinition, {});

        expect(result.events).toContainEqual(
            expect.objectContaining({ type: 'output', stream: 'stdout', text: '[server] listening\n' }),
        );
        expect(result.envelope.notices).toEqual([
            { level: 'warning', message: 'Another run holds the state file' },
        ]);
    });

    it('is a coded error when the run cannot start', async () => {
        runDev.mockResolvedValue({
            exitCode: 1,
            stopped: false,
            startError: 'Could not find ./src/index.ts.',
        });
        const result = await runCommandInHarness(devDefinition, {});
        expect(result.envelope.error).toMatchObject({
            code: 'dev.start-failed',
            message: 'Could not find ./src/index.ts.',
        });
    });

    it('fails when a process ended the run with an error, but not when the run was stopped', async () => {
        runDev.mockResolvedValue({ exitCode: 1, stopped: false });
        const crashed = await runCommandInHarness(devDefinition, {});
        expect(crashed.envelope.status).toBe('failed');
        expect(crashed.exitCode).toBe(1);

        runDev.mockResolvedValue({ exitCode: 130, stopped: true });
        const stopped = await runCommandInHarness(devDefinition, {});
        expect(stopped.envelope).toMatchObject({ status: 'ok', output: { processExitCode: 130 } });
        expect(stopped.exitCode).toBe(0);
    });
});
