import { AuthOptions } from '../../config/vendure-config';

/**
 * Returns true if the given `authOptions.tokenMethod` value includes the given method, whether it is
 * configured as a single string or as an array of methods.
 */
export function tokenMethodIncludes(
    tokenMethod: AuthOptions['tokenMethod'],
    method: 'cookie' | 'bearer',
): boolean {
    return tokenMethod === method || (Array.isArray(tokenMethod) && tokenMethod.includes(method));
}
