import { CommandContext, isFailedResult } from '@vendure/common/lib/command';
import { describe, expect, it, vi } from 'vitest';

import { DoctorReport } from './types.js';

const report: { value: unknown } = vi.hoisted(() => ({ value: undefined }));

vi.mock('./doctor.js', () => ({
    collectDoctorReport: vi.fn(async (_options: unknown, warn: (message: string) => void) => {
        warn('Unknown check(s): bogus');
        return report.value;
    }),
}));

import { run } from './doctor.run.js';

function context(): { ctx: CommandContext; notices: Array<[string, string]> } {
    const notices: Array<[string, string]> = [];
    const ctx = {
        notice: (level: string, message: string) => notices.push([level, message]),
    } as unknown as CommandContext;
    return { ctx, notices };
}

const base: DoctorReport = { nodeVersion: 'v22', checks: [], overallStatus: 'passed' };

describe('doctor run', () => {
    it('returns the report, and passes warnings about the options on as notices', async () => {
        report.value = base;
        const { ctx, notices } = context();
        expect(await run({}, ctx)).toBe(base);
        expect(notices).toEqual([['warning', 'Unknown check(s): bogus']]);
    });

    it('returns a failed result when the report failed', async () => {
        report.value = { ...base, overallStatus: 'failed' };
        const result = await run({}, context().ctx);
        expect(isFailedResult(result) && result.output).toEqual(report.value);
    });
});
