/* eslint-disable no-console */
import { CliLogLevel } from './types';

let logLevel: CliLogLevel = 'info';

export function setLogLevel(level: CliLogLevel = 'info') {
    logLevel = level;
}

export function log(
    message?: string,
    options?: { level?: CliLogLevel; newline?: 'before' | 'after' | 'both' },
) {
    const { level = 'info' } = options || {};
    if (logLevel !== 'silent' && (logLevel === 'verbose' || level === 'info')) {
        if (options?.newline === 'before' || options?.newline === 'both') {
            console.log();
        }
        console.log('   ' + (message ?? ''));
        if (options?.newline === 'after' || options?.newline === 'both') {
            console.log();
        }
    }
}
