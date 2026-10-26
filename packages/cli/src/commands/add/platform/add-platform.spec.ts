import { cancel, log } from '@clack/prompts';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CliCommandExit } from '../../../shared/cli-command-exit';
import { manifest, PROJECT_ID } from '../../console/console.fixtures';
import { getProjectLinkManifestPath } from '../../console/project-link-manifest';

import { addPlatform, PlatformTrialDependencies } from './add-platform';

vi.mock('@clack/prompts', () => ({
    cancel: vi.fn(),
    confirm: vi.fn(),
    isCancel: (value: unknown) => typeof value === 'symbol',
    log: { step: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

const STAGING = {
    appOrigin: 'https://staging.console.vendure.io',
    apiOrigin: 'https://staging.api.vendure.io',
};

const stdinIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
const stdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
let projectRoot: string;

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CI', 'false');
    vi.stubEnv('VENDURE_CLI_NON_INTERACTIVE', 'false');
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
    projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-add-platform-')));
    fs.writeJsonSync(path.join(projectRoot, 'package.json'), { dependencies: { '@vendure/core': '3.8.0' } });
});

afterEach(() => {
    vi.unstubAllEnvs();
    if (stdinIsTTY) Object.defineProperty(process.stdin, 'isTTY', stdinIsTTY);
    if (stdoutIsTTY) Object.defineProperty(process.stdout, 'isTTY', stdoutIsTTY);
    fs.removeSync(projectRoot);
});

/**
 * Exit codes for the link and the hand-over, in that order. A link that succeeds writes the
 * manifest, as `vendure console link` does.
 */
function dependencies(
    exitCodes: number[],
    trialStarted: boolean | symbol = true,
): PlatformTrialDependencies & { run: ReturnType<typeof vi.fn> } {
    const codes = [...exitCodes];
    const run = vi.fn(async (command: string, args: string[]) => {
        const code = codes.shift() ?? 0;
        if (args.includes('link') && code === 0) {
            fs.outputJsonSync(getProjectLinkManifestPath(projectRoot), { ...manifest, console: STAGING });
        }
        return code;
    });
    return {
        cwd: projectRoot,
        run,
        openUrl: vi.fn(async () => undefined),
        confirmTrialStarted: vi.fn(async () => trialStarted),
    };
}

async function exitCodeOf(promise: Promise<unknown>): Promise<number | undefined> {
    try {
        await promise;
        return undefined;
    } catch (error) {
        if (error instanceof CliCommandExit) {
            return error.exitCode;
        }
        throw error;
    }
}

describe('addPlatform', () => {
    it('links, opens the trial page and hands over to @vendure-platform/create with the link origins', async () => {
        const deps = dependencies([0, 0]);

        await expect(exitCodeOf(addPlatform(deps))).resolves.toBeUndefined();

        expect(deps.run).toHaveBeenCalledTimes(2);
        expect(deps.run.mock.calls[0][1].slice(1)).toEqual(['console', 'link']);
        expect(deps.openUrl).toHaveBeenCalledWith(
            `https://staging.console.vendure.io/projects/${PROJECT_ID}/subscription`,
        );
        const [command, args, options] = deps.run.mock.calls[1];
        expect([command, ...args]).toEqual(['npx', '--yes', '@vendure-platform/create@latest', 'add']);
        expect(options.cwd).toBe(projectRoot);
        expect(options.env).toMatchObject({
            VENDURE_CONSOLE_APP_URL: STAGING.appOrigin,
            VENDURE_CONSOLE_API_URL: STAGING.apiOrigin,
        });
    });

    it('stops with exit code 0 and runs nothing else when the link is cancelled', async () => {
        const deps = dependencies([130]);

        await expect(exitCodeOf(addPlatform(deps))).resolves.toBe(0);

        expect(deps.run).toHaveBeenCalledTimes(1);
        expect(deps.openUrl).not.toHaveBeenCalled();
        expect(cancel).toHaveBeenCalledWith(expect.stringContaining('Your project is unchanged.'));
    });

    it('stops with exit code 1 when the link fails', async () => {
        const deps = dependencies([1]);

        await expect(exitCodeOf(addPlatform(deps))).resolves.toBe(1);

        expect(deps.openUrl).not.toHaveBeenCalled();
        expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Your project is unchanged.'));
    });

    it('does not hand over without a valid Project Link Manifest', async () => {
        const deps = dependencies([0, 0]);
        deps.run.mockImplementationOnce(async () => {
            fs.outputFileSync(getProjectLinkManifestPath(projectRoot), '{');
            return 0;
        });

        await expect(exitCodeOf(addPlatform(deps))).resolves.toBe(0);

        expect(deps.run).toHaveBeenCalledTimes(1);
        expect(deps.openUrl).not.toHaveBeenCalled();
        expect(cancel).toHaveBeenCalledWith(expect.stringContaining('The file is not valid JSON.'));
        expect(cancel).toHaveBeenCalledWith(expect.stringContaining('vendure console link --force'));
    });

    it.each([
        ['cancelled', Symbol('clack:cancel')],
        ['declined', false],
    ])('stops before the hand-over when the trial question is %s', async (_, answer) => {
        const deps = dependencies([0], answer);

        await expect(exitCodeOf(addPlatform(deps))).resolves.toBe(0);

        expect(deps.run).toHaveBeenCalledTimes(1);
        expect(cancel).toHaveBeenCalledWith(expect.stringContaining('nothing else changed'));
    });

    it('stops with exit code 0 and names the command to finish when the hand-over is cancelled', async () => {
        const deps = dependencies([0, 130]);

        await expect(exitCodeOf(addPlatform(deps))).resolves.toBe(0);

        expect(cancel).toHaveBeenCalledWith(
            expect.stringContaining('npx --yes @vendure-platform/create@latest add'),
        );
    });

    it('continues when no browser opens, so the user can open the printed URL', async () => {
        const deps = dependencies([0, 0]);
        deps.openUrl = vi.fn(async () => {
            throw new Error('no browser');
        });

        await expect(exitCodeOf(addPlatform(deps))).resolves.toBeUndefined();

        expect(log.warn).toHaveBeenCalledWith('Could not open a browser. Open the URL above.');
        expect(deps.run).toHaveBeenCalledTimes(2);
    });

    it('runs nothing in a non-interactive environment', async () => {
        vi.stubEnv('CI', 'true');
        const deps = dependencies([0, 0]);

        await expect(exitCodeOf(addPlatform(deps))).resolves.toBe(1);

        expect(deps.run).not.toHaveBeenCalled();
        expect(deps.openUrl).not.toHaveBeenCalled();
    });
});
