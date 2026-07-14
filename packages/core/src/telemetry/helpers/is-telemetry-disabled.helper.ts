import { isCI } from './ci-detector.helper';

/**
 * Checks if telemetry is disabled via the VENDURE_DISABLE_TELEMETRY environment
 * variable or CI environment detection.
 */
export function isTelemetryDisabled(): boolean {
    const disableEnv = process.env.VENDURE_DISABLE_TELEMETRY?.toLowerCase();
    return disableEnv === 'true' || disableEnv === '1' || isCI();
}
