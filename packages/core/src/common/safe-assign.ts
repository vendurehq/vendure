/**
 * Safely assigns a property to an object, preventing prototype pollution.
 *
 * This function guards against prototype pollution by:
 * 1. Blocking dangerous property names (__proto__, constructor, prototype)
 * 2. Using Object.defineProperty for safer assignment instead of direct assignment
 *
 * @param target - The target object to assign the property to
 * @param key - The property key to assign
 * @param value - The value to assign to the property
 */
export function safeAssign(target: any, key: string, value: any): void {
    // Guard against prototype pollution by blocking dangerous property names
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        return;
    }

    // Use Object.defineProperty for safer assignment
    Object.defineProperty(target, key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
    });
}
