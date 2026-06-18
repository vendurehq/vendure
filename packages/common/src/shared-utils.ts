import { CustomFieldConfig } from './generated-types';

/**
 * Predicate with type guard, used to filter out null or undefined values
 * in a filter operation.
 */
export function notNullOrUndefined<T>(val: T | undefined | null): val is T {
    return val !== undefined && val !== null;
}

/**
 * Used in exhaustiveness checks to assert a codepath should never be reached.
 */
export function assertNever(value: never): never {
    throw new Error(`Expected never, got ${typeof value} (${JSON.stringify(value)})`);
}

/**
 * Simple object check.
 * From https://stackoverflow.com/a/34749873/772859
 */
export function isObject(item: any): item is object {
    return item && typeof item === 'object' && !Array.isArray(item);
}

export function isClassInstance(item: any): boolean {
    // Even if item is an object, it might not have a constructor as in the
    // case when it is a null-prototype object, i.e. created using `Object.create(null)`.
    return isObject(item) && item.constructor && item.constructor.name !== 'Object';
}

type NumericPropsOf<T> = {
    [K in keyof T]: T[K] extends number ? K : never;
}[keyof T];

// homomorphic helper type
// From https://stackoverflow.com/a/56140392/772859
type NPO<T, KT extends keyof T> = {
    [K in KT]: T[K] extends string | number | boolean
        ? T[K]
        : T[K] extends Array<infer A>
        ? Array<OnlyNumerics<A>>
        : OnlyNumerics<T[K]>;
};

// quick abort if T is a function or primitive
// otherwise pass to a homomorphic helper type
type OnlyNumerics<T> = NPO<T, NumericPropsOf<T>>;

/**
 * Adds up all the values of a given numeric property of a list of objects.
 */
export function summate<T extends OnlyNumerics<T>>(
    items: T[] | undefined | null,
    prop: keyof OnlyNumerics<T>,
): number {
    return (items || []).reduce((sum, i) => sum + (i[prop] as unknown as number), 0);
}

/**
 * Given an array of option arrays `[['red, 'blue'], ['small', 'large']]`, this method returns a new array
 * containing all the combinations of those options:
 *
 * @example
 * ```
 * generateAllCombinations([['red, 'blue'], ['small', 'large']]);
 * // =>
 * // [
 * //  ['red', 'small'],
 * //  ['red', 'large'],
 * //  ['blue', 'small'],
 * //  ['blue', 'large'],
 * // ]
 */
export function generateAllCombinations<T>(
    optionGroups: T[][],
    combination: T[] = [],
    k: number = 0,
    output: T[][] = [],
): T[][] {
    if (k === 0) {
        optionGroups = optionGroups.filter(g => 0 < g.length);
    }
    if (k === optionGroups.length) {
        output.push(combination);
        return [];
    } else {
        /* eslint-disable @typescript-eslint/prefer-for-of */
        for (let i = 0; i < optionGroups[k].length; i++) {
            generateAllCombinations(optionGroups, combination.concat(optionGroups[k][i]), k + 1, output);
        }
        /* eslint-enable @typescript-eslint/prefer-for-of */
        return output;
    }
}

/**
 * @description
 * Returns the input field name of a custom field, taking into account that "relation" type custom
 * field inputs are suffixed with "Id" or "Ids".
 */
export function getGraphQlInputName(config: { name: string; type: string; list?: boolean }): string {
    if (config.type === 'relation') {
        return config.list === true ? `${config.name}Ids` : `${config.name}Id`;
    } else {
        return config.name;
    }
}
