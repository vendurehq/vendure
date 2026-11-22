import { formatConsoleReport } from './formatters/console-formatter.js';
import { DoctorReport } from './types.js';

export function render(report: DoctorReport): void {
    formatConsoleReport(report);
}
