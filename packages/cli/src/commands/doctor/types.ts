export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

export interface CheckResult {
    name: string;
    status: CheckStatus;
    message: string;
    details?: string[];
    /** Only set by the project check. Omitted from JSON output when undefined. */
    packageManager?: string;
}

export interface DoctorOptions {
    config?: string;
    check?: string[];
    profile?: string;
    format?: 'text' | 'json';
    strict?: boolean;
}

export interface DoctorReport {
    vendureVersion?: string;
    nodeVersion: string;
    packageManager?: string;
    checks: CheckResult[];
    overallStatus: 'passed' | 'failed';
}
