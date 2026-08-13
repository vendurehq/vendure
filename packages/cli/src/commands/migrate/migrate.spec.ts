import { log, select } from '@clack/prompts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { migrateCommand } from './migrate';
import {
    generateMigrationOperation,
    revertMigrationOperation,
    runMigrationsOperation,
} from './migration-operations';

const commandMocks = vi.hoisted(() => ({
    generateMigrationRun: vi.fn(),
    revertMigrationRun: vi.fn(),
    runMigrationRun: vi.fn(),
}));

vi.mock('@clack/prompts', () => ({
    cancel: vi.fn(),
    intro: vi.fn(),
    isCancel: vi.fn(() => false),
    log: {
        error: vi.fn(),
        info: vi.fn(),
        success: vi.fn(),
    },
    outro: vi.fn(),
    select: vi.fn(),
}));

vi.mock('../../utilities/utils', () => ({
    abortIfNonInteractive: vi.fn(() => false),
    withInteractiveTimeout: vi.fn((fn: () => Promise<any>) => fn()),
}));

vi.mock('./migration-operations', () => ({
    generateMigrationOperation: vi.fn(),
    revertMigrationOperation: vi.fn(),
    runMigrationsOperation: vi.fn(),
}));

vi.mock('./generate-migration/generate-migration', () => ({
    generateMigrationCommand: {
        run: commandMocks.generateMigrationRun,
    },
}));

vi.mock('./revert-migration/revert-migration', () => ({
    revertMigrationCommand: {
        run: commandMocks.revertMigrationRun,
    },
}));

vi.mock('./run-migration/run-migration', () => ({
    runMigrationCommand: {
        run: commandMocks.runMigrationRun,
    },
}));

describe('migrateCommand()', () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.VENDURE_RUNNING_IN_CLI;
        process.exitCode = undefined;
        consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

        vi.mocked(generateMigrationOperation).mockResolvedValue({
            success: true,
            message: 'generated',
        });
        vi.mocked(runMigrationsOperation).mockResolvedValue({
            success: true,
            message: 'ran',
            migrationsRan: [],
        });
        vi.mocked(revertMigrationOperation).mockResolvedValue({
            success: true,
            message: 'reverted',
        });

        commandMocks.generateMigrationRun.mockResolvedValue({
            project: {} as any,
            modifiedSourceFiles: [],
        });
        commandMocks.runMigrationRun.mockResolvedValue({
            project: {} as any,
            modifiedSourceFiles: [],
        });
        commandMocks.revertMigrationRun.mockResolvedValue({
            project: {} as any,
            modifiedSourceFiles: [],
        });
    });

    afterEach(() => {
        delete process.env.VENDURE_RUNNING_IN_CLI;
        process.exitCode = undefined;
        consoleLogSpy.mockRestore();
    });

    it('passes the custom config file through to interactive revert', async () => {
        vi.mocked(select).mockResolvedValueOnce('revert');

        await migrateCommand({ config: './custom-vendure-config.ts' });

        expect(commandMocks.revertMigrationRun).toHaveBeenCalledWith({
            configFile: './custom-vendure-config.ts',
        });
        expect(process.exitCode).toBeUndefined();
        expect(process.env.VENDURE_RUNNING_IN_CLI).toBeUndefined();
    });

    it('sets a non-zero exit code when an interactive operation throws', async () => {
        vi.mocked(select).mockResolvedValueOnce('run');
        commandMocks.runMigrationRun.mockRejectedValueOnce(new Error('interactive migration failed'));

        await migrateCommand();

        expect(log.error).toHaveBeenCalledWith('interactive migration failed');
        expect(process.exitCode).toBe(1);
        expect(process.env.VENDURE_RUNNING_IN_CLI).toBeUndefined();
    });

    it('rejects conflicting non-interactive operations instead of silently picking one', async () => {
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
            throw new Error(`process.exit ${String(code)}`);
        }) as never);

        try {
            await expect(migrateCommand({ generate: 'TestMigration', run: true })).rejects.toThrow(
                'process.exit 1',
            );
        } finally {
            exitSpy.mockRestore();
        }

        expect(log.error).toHaveBeenCalledWith(
            'The migrate command accepts only one operation at a time. Received: --generate, --run.',
        );
        expect(log.info).toHaveBeenCalledWith(
            'Run one of: vendure migrate --generate <name>, vendure migrate --run, or vendure migrate --revert.',
        );
        expect(generateMigrationOperation).not.toHaveBeenCalled();
        expect(runMigrationsOperation).not.toHaveBeenCalled();
        expect(revertMigrationOperation).not.toHaveBeenCalled();
    });

    it('passes the custom config file through to non-interactive revert', async () => {
        await migrateCommand({ revert: true, config: './custom-vendure-config.ts' });

        expect(revertMigrationOperation).toHaveBeenCalledWith('./custom-vendure-config.ts');
        expect(log.success).toHaveBeenCalledWith('reverted');
        expect(process.env.VENDURE_RUNNING_IN_CLI).toBeUndefined();
    });

    it('cleans up the CLI env var when a non-interactive operation throws', async () => {
        vi.mocked(runMigrationsOperation).mockRejectedValueOnce(new Error('migration failed'));
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
            throw new Error(`process.exit ${String(code)}`);
        }) as never);

        try {
            await expect(migrateCommand({ run: true })).rejects.toThrow('process.exit 1');
        } finally {
            exitSpy.mockRestore();
        }

        expect(log.error).toHaveBeenCalledWith('migration failed');
        expect(process.env.VENDURE_RUNNING_IN_CLI).toBeUndefined();
    });
});
