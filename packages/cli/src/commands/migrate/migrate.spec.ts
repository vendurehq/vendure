import { log, select } from '@clack/prompts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runCoreCommand } from '../../command-host/run-core-command.js';

import { migrateCommandDef } from './command.js';
import { migrateCommand } from './migrate.js';

vi.mock('@clack/prompts', () => ({
    cancel: vi.fn(),
    intro: vi.fn(),
    isCancel: vi.fn(() => false),
    log: { error: vi.fn(), info: vi.fn() },
    select: vi.fn(),
}));

vi.mock('../../utilities/utils.js', () => ({
    abortIfNonInteractive: vi.fn(() => false),
    withInteractiveTimeout: vi.fn((fn: () => Promise<any>) => fn()),
}));

vi.mock('../../command-host/run-core-command.js', () => ({
    runCoreCommand: vi.fn(() => Promise.resolve(0)),
}));

describe('migrateCommand()', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    it('runs `migrate generate` through the host for --generate', async () => {
        await migrateCommand({ generate: 'AddReviews', outputDir: './migrations', fromEmpty: true });

        expect(runCoreCommand).toHaveBeenCalledWith(['migrate', 'generate'], {
            name: 'AddReviews',
            outputDir: './migrations',
            fromEmpty: true,
            config: undefined,
        });
    });

    it('runs `migrate run` through the host for --run, with the config file', async () => {
        await migrateCommand({ run: true, config: './custom-vendure-config.ts' });

        expect(runCoreCommand).toHaveBeenCalledWith(['migrate', 'run'], {
            config: './custom-vendure-config.ts',
        });
    });

    it.each(['generate', 'run', 'revert'])(
        'runs `migrate %s` through the host from the menu',
        async action => {
            vi.mocked(select).mockResolvedValueOnce(action);

            await migrateCommand({ config: './custom-vendure-config.ts' });

            expect(runCoreCommand).toHaveBeenCalledWith(['migrate', action], {
                config: './custom-vendure-config.ts',
            });
        },
    );

    it('returns the exit code of the host command', async () => {
        vi.mocked(runCoreCommand).mockResolvedValueOnce(1);

        await expect(migrateCommandDef.action({ run: true })).resolves.toBe(1);
    });

    it('rejects conflicting operations instead of silently picking one', async () => {
        await expect(migrateCommandDef.action({ generate: 'TestMigration', run: true })).resolves.toBe(1);

        expect(log.error).toHaveBeenCalledWith(
            'The migrate command accepts only one operation at a time. Received: --generate, --run.',
        );
        expect(runCoreCommand).not.toHaveBeenCalled();
    });

    it('rejects --from-empty without --generate', async () => {
        await expect(migrateCommandDef.action({ run: true, fromEmpty: true })).resolves.toBe(1);

        expect(runCoreCommand).not.toHaveBeenCalled();
    });

    it('no longer has a --revert flag', () => {
        expect(migrateCommandDef.options?.map(option => option.long)).not.toContain('--revert');
    });
});
