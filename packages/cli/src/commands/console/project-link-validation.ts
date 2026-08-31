export function objectValue(value: unknown, errorMessage: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(errorMessage);
    }
    return value as Record<string, unknown>;
}

export function exactObjectValue(
    value: unknown,
    keys: string[],
    objectErrorMessage: string,
    fieldsErrorMessage: string,
): Record<string, unknown> {
    const object = objectValue(value, objectErrorMessage);
    const actualKeys = Object.keys(object).sort((a, b) => a.localeCompare(b));
    const expectedKeys = [...keys].sort((a, b) => a.localeCompare(b));
    if (
        actualKeys.length !== expectedKeys.length ||
        actualKeys.some((key, index) => key !== expectedKeys[index])
    ) {
        throw new Error(fieldsErrorMessage);
    }
    return object;
}

export function uuid(value: unknown, errorMessage: string): string {
    if (
        typeof value !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ) {
        throw new Error(errorMessage);
    }
    return value;
}

export function nonEmptyString(value: unknown, errorMessage: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(errorMessage);
    }
    return value;
}
