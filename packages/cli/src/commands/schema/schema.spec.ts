import { log, select, text } from '@clack/prompts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateSchema } from './generate-schema/generate-schema';
import { schemaCommand } from './schema';

vi.mock('@clack/prompts', () => ({
    cancel: vi.fn(),
    intro: vi.fn(),
    isCancel: vi.fn(() => false),
    log: {
        error: vi.fn(),
    },
    outro: vi.fn(),
    select: vi.fn(),
    text: vi.fn(),
}));

vi.mock('../../utilities/utils', () => ({
    abortIfNonInteractive: vi.fn(() => false),
    withInteractiveTimeout: vi.fn((fn: () => Promise<any>) => fn()),
}));

vi.mock('./generate-schema/generate-schema', () => ({
    generateSchema: vi.fn(),
}));

describe('schemaCommand()', () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.VENDURE_RUNNING_IN_CLI;
        process.exitCode = undefined;
        consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.mocked(generateSchema).mockResolvedValue(undefined);
    });

    afterEach(() => {
        delete process.env.VENDURE_RUNNING_IN_CLI;
        process.exitCode = undefined;
        consoleLogSpy.mockRestore();
    });

    it('cleans up the CLI env var after a non-interactive schema generation', async () => {
        await schemaCommand({ api: 'admin' });

        expect(generateSchema).toHaveBeenCalledWith({ api: 'admin' });
        expect(process.env.VENDURE_RUNNING_IN_CLI).toBeUndefined();
    });

    it('cleans up the CLI env var when schema generation throws', async () => {
        vi.mocked(generateSchema).mockRejectedValueOnce(new Error('schema failed'));
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
            throw new Error(`process.exit ${String(code)}`);
        }) as never);

        try {
            await expect(schemaCommand({ api: 'admin' })).rejects.toThrow('process.exit 1');
        } finally {
            exitSpy.mockRestore();
        }

        expect(log.error).toHaveBeenCalledWith('schema failed');
        expect(process.env.VENDURE_RUNNING_IN_CLI).toBeUndefined();
    });

    it('sets a non-zero exit code when interactive schema generation throws', async () => {
        vi.mocked(select).mockResolvedValueOnce('admin').mockResolvedValueOnce('sdl');
        vi.mocked(text).mockResolvedValueOnce('/tmp').mockResolvedValueOnce('schema.graphql');
        vi.mocked(generateSchema).mockRejectedValueOnce(new Error('interactive schema failed'));

        await schemaCommand();

        expect(log.error).toHaveBeenCalledWith('interactive schema failed');
        expect(process.exitCode).toBe(1);
        expect(process.env.VENDURE_RUNNING_IN_CLI).toBeUndefined();
    });
});
