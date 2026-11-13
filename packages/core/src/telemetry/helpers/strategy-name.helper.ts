import { getBaseStrategy } from '../../config/strategy-layer/compose-strategy';

/**
 * Gets the name of a strategy, resilient to code minification.
 * Prefers an explicit `name` property (e.g. AuthenticationStrategy.name),
 * then falls back to `constructor.name`. Returns 'unknown' if the name
 * appears to be minified (single char or empty). For a composed strategy, returns the name of
 * its base strategy.
 */
export function getStrategyName(input: object | null | undefined): string {
    if (input == null) {
        return 'unknown';
    }
    const strategy = getBaseStrategy(input);
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
