/**
 * @description
 * Formats a money amount in minor units, such as cents, as a decimal string. Pass the
 * `precision` of the store's `MoneyStrategy` (2 by default) as the number of decimal places.
 *
 * Return it next to the raw amount in a tool result, so a language model can quote a price
 * without doing the division itself.
 *
 * @example
 * ```ts
 * import { toDecimalString } from '\@vendure/mcp-sdk';
 *
 * toDecimalString(25199, 2); // '251.99'
 * toDecimalString(5, 2); // '0.05'
 * toDecimalString(-150, 2); // '-1.50'
 * toDecimalString(1000, 0); // '1000'
 * ```
 *
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
export function toDecimalString(amount: number | undefined | null, precision: number): string {
    // Only matters if a store configures its own money strategy that can hand over a
    // fractional amount; under the default one this is already a whole number.
    const rounded = Math.round(amount ?? 0);
    const negative = rounded < 0;
    const digits = String(Math.abs(rounded));
    if (precision === 0) {
        return `${negative ? '-' : ''}${digits}`;
    }
    // The digits are shifted as text rather than divided, because dividing by 100 can introduce
    // floating-point error on real-world prices.
    const padded = digits.padStart(precision + 1, '0');
    const whole = padded.slice(0, -precision);
    const fraction = padded.slice(-precision);
    return `${negative ? '-' : ''}${whole}.${fraction}`;
}
