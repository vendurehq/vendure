import { describe, expect, it, vi } from 'vitest';

import { DoctorReport } from '../types';
import { formatJsonReport } from './json-formatter';

describe('json-formatter', () => {
    it('outputs valid JSON to stdout', () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        const report: DoctorReport = {
            vendureVersion: '3.6.3',
            nodeVersion: 'v20.0.0',
            packageManager: 'bun',
            checks: [{ name: 'Project', status: 'pass', message: 'OK' }],
            overallStatus: 'passed',
        };

        formatJsonReport(report);

        const output = consoleSpy.mock.calls[0][0];
        const parsed = JSON.parse(output);

        expect(parsed.vendureVersion).toBe('3.6.3');
        expect(parsed.nodeVersion).toBe('v20.0.0');
        expect(parsed.packageManager).toBe('bun');
        expect(parsed.checks).toHaveLength(1);
        expect(parsed.overallStatus).toBe('passed');

        consoleSpy.mockRestore();
    });

    it('omits undefined fields from JSON output', () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        const report: DoctorReport = {
            nodeVersion: 'v20.0.0',
            checks: [{ name: 'Project', status: 'pass', message: 'OK' }],
            overallStatus: 'passed',
        };

        formatJsonReport(report);

        const output = consoleSpy.mock.calls[0][0];
        const parsed = JSON.parse(output);

        expect(parsed).not.toHaveProperty('vendureVersion');
        expect(parsed).not.toHaveProperty('packageManager');

        consoleSpy.mockRestore();
    });

    it('does not include packageManager on non-project checks', () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        const report: DoctorReport = {
            nodeVersion: 'v20.0.0',
            checks: [
                { name: 'Project', status: 'pass', message: 'OK', packageManager: 'bun' },
                { name: 'Dependencies', status: 'pass', message: 'OK' },
            ],
            overallStatus: 'passed',
        };

        formatJsonReport(report);

        const output = consoleSpy.mock.calls[0][0];
        const parsed = JSON.parse(output);

        expect(parsed.checks[0].packageManager).toBe('bun');
        expect(parsed.checks[1]).not.toHaveProperty('packageManager');

        consoleSpy.mockRestore();
    });
});
