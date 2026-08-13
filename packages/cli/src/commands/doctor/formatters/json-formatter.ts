import { DoctorReport } from '../types';

/**
 * Outputs the doctor report as structured JSON to stdout.
 * Suitable for CI pipelines, agent workflows, and machine consumption.
 */
export function formatJsonReport(report: DoctorReport): void {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(report, null, 2));
}
