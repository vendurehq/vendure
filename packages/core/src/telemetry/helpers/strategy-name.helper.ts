/**
 * Gets the name of a strategy, resilient to code minification.
 * Prefers an explicit `name` property (e.g. AuthenticationStrategy.name),
 * then falls back to `constructor.name`. Returns 'unknown' if the name
 * appears to be minified (single char or empty).
 */
export function getStrategyName(strategy: object | null | undefined): string {
    if (strategy == null) {
        return 'unknown';
    }
    const name = (strategy as any).name;
    if (typeof name === 'string' && name.length > 1) {
        return name;
    }
    const ctorName = strategy.constructor?.name;
    if (ctorName && ctorName.length > 1) {
        return ctorName;
    }
    return 'unknown';
}
