import { beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from './logger';
import { offerPlatformTrial, PLATFORM_TRIAL_QUESTION, PlatformTrialDependencies } from './platform-trial';

vi.mock('./logger', () => ({ log: vi.fn() }));

function dependencies(overrides: Partial<PlatformTrialDependencies> = {}) {
    return {
        env: {},
        isTTY: true,
        confirm: vi.fn(async (): Promise<boolean | symbol> => true),
        runPlatformFlow: vi.fn(async () => 0),
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

// OSS-893: @vendure/create asks to start the Platform trial and runs the `vendure add` flow on Yes.
describe('offerPlatformTrial()', () => {
    it('asks the trial question and runs the Platform flow in the project on Yes', async () => {
        const deps = dependencies();

        await offerPlatformTrial('/projects/shop', false, deps);

        expect(deps.confirm).toHaveBeenCalledWith(PLATFORM_TRIAL_QUESTION);
        expect(deps.runPlatformFlow).toHaveBeenCalledWith('/projects/shop');
        expect(log).not.toHaveBeenCalled();
    });

    it.each([
        ['declined', false],
        ['cancelled', Symbol('clack:cancel')],
    ])('runs nothing when the question is %s', async (_, answer) => {
        const deps = dependencies({ confirm: vi.fn(async () => answer) });

        await offerPlatformTrial('/projects/shop', false, deps);

        expect(deps.runPlatformFlow).not.toHaveBeenCalled();
    });

    it.each([
        ['--ci', true, {}, true],
        ['CI=true', false, { CI: 'true' }, true],
        ['VENDURE_CLI_NON_INTERACTIVE=1', false, { VENDURE_CLI_NON_INTERACTIVE: '1' }, true],
        ['no TTY', false, {}, false],
    ])('skips the question and runs nothing with %s', async (_, isCi, env, isTTY) => {
        const deps = dependencies({ env, isTTY });

        await offerPlatformTrial('/projects/shop', isCi, deps);

        expect(deps.confirm).not.toHaveBeenCalled();
        expect(deps.runPlatformFlow).not.toHaveBeenCalled();
        expect(log).not.toHaveBeenCalled();
    });

    it('names the command to try again when the flow does not finish', async () => {
        const deps = dependencies({ runPlatformFlow: vi.fn(async () => 1) });

        await offerPlatformTrial('/projects/shop', false, deps);

        expect(log).toHaveBeenCalledWith(expect.stringContaining('vendure add --platform'), {
            newline: 'after',
        });
    });
});
