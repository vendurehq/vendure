import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DoctorReport } from '../types';

// Mock @clack/prompts
vi.mock('@clack/prompts', () => ({
    log: {
        info: vi.fn(),
        error: vi.fn(),
        success: vi.fn(),
    },
}));

// Mock picocolors to return plain text for easier assertion
vi.mock('picocolors', () => ({
    default: {
        green: (s: string) => s,
        yellow: (s: string) => s,
        red: (s: string) => s,
        dim: (s: string) => s,
        bold: (s: string) => s,
    },
}));

import { log } from '@clack/prompts';

import { formatConsoleReport } from './console-formatter';

describe('console-formatter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders pass status', () => {
        const report: DoctorReport = {
            nodeVersion: 'v20.0.0',
            checks: [{ name: 'Project', status: 'pass', message: 'All good' }],
            overallStatus: 'passed',
        };

        formatConsoleReport(report);

        expect(vi.mocked(log.info)).toHaveBeenCalledWith(expect.stringContaining('pass'));
        expect(vi.mocked(log.info)).toHaveBeenCalledWith(expect.stringContaining('All good'));
        expect(vi.mocked(log.success)).toHaveBeenCalledWith(expect.stringContaining('passed'));
    });

    it('renders fail status with failure count', () => {
        const report: DoctorReport = {
            nodeVersion: 'v20.0.0',
            checks: [{ name: 'Config', status: 'fail', message: 'Broken' }],
            overallStatus: 'failed',
        };

        formatConsoleReport(report);

        expect(vi.mocked(log.info)).toHaveBeenCalledWith(expect.stringContaining('fail'));
        expect(vi.mocked(log.error)).toHaveBeenCalledWith(expect.stringContaining('1 failure'));
    });

    it('renders warn status with warning count', () => {
        const report: DoctorReport = {
            nodeVersion: 'v20.0.0',
            checks: [{ name: 'Dependencies', status: 'warn', message: 'Some warning' }],
            overallStatus: 'passed',
        };

        formatConsoleReport(report);

        expect(vi.mocked(log.info)).toHaveBeenCalledWith(expect.stringContaining('warn'));
        expect(vi.mocked(log.success)).toHaveBeenCalledWith(expect.stringContaining('1 warning'));
    });

    it('renders skip status', () => {
        const report: DoctorReport = {
            nodeVersion: 'v20.0.0',
            checks: [{ name: 'Schema', status: 'skip', message: 'Skipped' }],
            overallStatus: 'passed',
        };

        formatConsoleReport(report);

        expect(vi.mocked(log.info)).toHaveBeenCalledWith(expect.stringContaining('skip'));
    });

    it('renders detail lines', () => {
        const report: DoctorReport = {
            nodeVersion: 'v20.0.0',
            checks: [
                {
                    name: 'Project',
                    status: 'pass',
                    message: 'OK',
                    details: ['Package manager: bun', 'Node.js v20.0.0'],
                },
            ],
            overallStatus: 'passed',
        };

        formatConsoleReport(report);

        // Header + 2 detail lines = 3 log.info calls (plus the Vendure Doctor header)
        const infoCalls = vi.mocked(log.info).mock.calls.map(c => c[0]);
        expect(infoCalls.some(c => c.includes('Package manager: bun'))).toBe(true);
        expect(infoCalls.some(c => c.includes('Node.js v20.0.0'))).toBe(true);
    });

    it('renders multiple failures and warnings count', () => {
        const report: DoctorReport = {
            nodeVersion: 'v20.0.0',
            checks: [
                { name: 'Dependencies', status: 'fail', message: 'Bad' },
                { name: 'Config', status: 'warn', message: 'Meh' },
                { name: 'Production', status: 'fail', message: 'Unsafe' },
            ],
            overallStatus: 'failed',
        };

        formatConsoleReport(report);

        expect(vi.mocked(log.error)).toHaveBeenCalledWith(
            expect.stringContaining('2 failures'),
        );
        expect(vi.mocked(log.error)).toHaveBeenCalledWith(
            expect.stringContaining('1 warning'),
        );
    });
});
