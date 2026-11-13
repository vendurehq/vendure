/**
 * @description
 * Performs a case-insensitive comparison of two coupon codes.
 * Centralizes the normalization logic so that if it ever needs to change
 * (e.g. trimming whitespace, using `toLocaleLowerCase()`), only this
 * single function needs updating.
 */
export function couponCodesMatch(a: string, b: string): boolean {
    return a.toLowerCase() === b.toLowerCase();
}
