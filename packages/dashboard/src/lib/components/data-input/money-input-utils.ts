/**
 * Formats a minor-units money value as a major-units string with exactly
 * `precision` decimal places, matching the server's `moneyStrategyPrecision`.
 * The decimal separator is `decimalSeparator`, so that the value reads as it is typed.
 */
export function formatMoneyInputValue(minorUnits: number, precision: number, decimalSeparator = '.'): string {
    return (minorUnits / Math.pow(10, precision)).toFixed(precision).replace('.', decimalSeparator);
}

/**
 * Returns the smallest major-units increment representable at `precision`.
 */
export function getMoneyInputStep(precision: number): number {
    return 1 / Math.pow(10, precision);
}

/**
 * Returns the decimal separator of the `bcp47Tag` locale, such as `,` for `de-DE`.
 */
export function getDecimalSeparator(bcp47Tag: string): string {
    try {
        return (
            new Intl.NumberFormat(bcp47Tag).formatToParts(1.1).find(part => part.type === 'decimal')?.value ??
            '.'
        );
    } catch {
        return '.';
    }
}

/**
 * Returns whether `text` may be typed into the money input: digits with at most one
 * decimal separator. A dot is always accepted as the separator, as well as the locale's
 * `decimalSeparator`. Any other character, such as a thousands separator, is rejected.
 */
export function isMoneyInputText(text: string, decimalSeparator: string): boolean {
    const separators = new Set(['.', decimalSeparator]);
    let separatorCount = 0;
    for (const char of text) {
        if (separators.has(char)) {
            separatorCount++;
        } else if (char < '0' || char > '9') {
            return false;
        }
    }
    return separatorCount <= 1;
}

/**
 * Parses text accepted by {@link isMoneyInputText} as a major-units number, or returns
 * `NaN` if it holds no number.
 */
export function parseMoneyInputValue(text: string, decimalSeparator: string): number {
    return Number.parseFloat(text.replace(decimalSeparator, '.'));
}
