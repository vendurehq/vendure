/**
 * Formats a minor-units money value as a major-units string with exactly
 * `precision` decimal places, matching the server's `moneyStrategyPrecision`.
 */
export function formatMoneyInputValue(minorUnits: number, precision: number): string {
    return (minorUnits / Math.pow(10, precision)).toFixed(precision);
}

/**
 * Returns the smallest major-units increment representable at `precision`.
 */
export function getMoneyInputStep(precision: number): number {
    return 1 / Math.pow(10, precision);
}
