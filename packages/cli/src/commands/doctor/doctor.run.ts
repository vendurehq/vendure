import { CommandContext, failed } from '@vendure/common/lib/command';

import { collectDoctorReport } from './doctor.js';
import { DoctorOptions } from './types.js';

/**
 * Runs the checks. A report with a failed check is a `failed` result: the output is still
 * reported, and the exit code is not zero.
 */
export async function run(input: DoctorOptions, ctx: CommandContext) {
    const report = await collectDoctorReport(input, message => ctx.notice('warning', message), ctx.signal);
    return report.overallStatus === 'failed' ? failed(report) : report;
}
