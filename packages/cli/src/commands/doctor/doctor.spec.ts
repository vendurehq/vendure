import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @clack/prompts
vi.mock('@clack/prompts', () => ({
    log: {
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
        success: vi.fn(),
    },
}));

import { log } from '@clack/prompts';

describe('doctor command internals', () => {
    let mockExit: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
        // Re-apply process.exit spy after resetModules
        mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('resolveChecks', () => {
        it('warns about unknown check names via doctorCommand', async () => {
            vi.doMock('./checks/project-check', () => ({
                runProjectCheck: vi.fn().mockResolvedValue({
                    name: 'Project',
                    status: 'fail',
                    message: 'No package.json',
                }),
            }));
            vi.doMock('./formatters/console-formatter', () => ({
                formatConsoleReport: vi.fn(),
            }));
            vi.doMock('./formatters/json-formatter', () => ({
                formatJsonReport: vi.fn(),
            }));

            const { doctorCommand } = await import('./doctor');

            await doctorCommand({ check: ['invalid-check'] });

            expect(vi.mocked(log.warn)).toHaveBeenCalledWith(
                expect.stringContaining('Unknown check(s): invalid-check'),
            );
        });
    });

    describe('buildReport', () => {
        it('marks report as failed when any check fails', async () => {
            vi.doMock('./checks/project-check', () => ({
                runProjectCheck: vi.fn().mockResolvedValue({
                    name: 'Project',
                    status: 'fail',
                    message: 'No package.json',
                }),
            }));
            vi.doMock('./formatters/json-formatter', () => ({
                formatJsonReport: vi.fn(),
            }));

            const { doctorCommand } = await import('./doctor');

            await doctorCommand({ check: ['project'], format: 'json' });

            expect(mockExit).toHaveBeenCalledWith(1);
        });
    });

    describe('--strict mode', () => {
        it('treats warnings as failures with --strict', async () => {
            vi.doMock('./checks/project-check', () => ({
                runProjectCheck: vi.fn().mockResolvedValue({
                    name: 'Project',
                    status: 'warn',
                    message: 'Some warning',
                }),
            }));
            vi.doMock('./formatters/json-formatter', () => ({
                formatJsonReport: vi.fn(),
            }));

            const { doctorCommand } = await import('./doctor');

            await doctorCommand({ check: ['project'], format: 'json', strict: true });

            expect(mockExit).toHaveBeenCalledWith(1);
        });
    });

    describe('--profile validation', () => {
        it('warns about unknown profile', async () => {
            vi.doMock('./checks/project-check', () => ({
                runProjectCheck: vi.fn().mockResolvedValue({
                    name: 'Project',
                    status: 'fail',
                    message: 'No package.json',
                }),
            }));
            vi.doMock('./formatters/console-formatter', () => ({
                formatConsoleReport: vi.fn(),
            }));

            const { doctorCommand } = await import('./doctor');

            await doctorCommand({ check: ['project'], profile: 'staging' });

            expect(vi.mocked(log.warn)).toHaveBeenCalledWith(
                expect.stringContaining('Unknown profile: staging'),
            );
        });
    });
});
