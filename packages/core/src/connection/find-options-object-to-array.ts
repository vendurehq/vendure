import { FindOneOptions } from 'typeorm';
import { FindOptionsRelationByString } from 'typeorm/find-options/FindOptionsRelations';

/**
 * Some internal APIs depend on the TypeORM FindOptions `relations` property being a string array.
 * This function converts the new-style FindOptionsRelations object to a string array.
 */
export function findOptionsObjectToArray<T>(
    input: NonNullable<FindOneOptions['relations']>,
    parentKey?: string,
): FindOptionsRelationByString {
    if (Array.isArray(input)) {
        return input;
    }
    const keys = Object.keys(input);

    return keys.reduce((acc: string[], key: string) => {
        const value = input[key as any];
        const path = parentKey ? `${parentKey}.${key}` : key;

        acc.push(path); // Push parent key instead of path
        if (typeof value === 'object' && value !== null) {
            const subKeys = findOptionsObjectToArray(value, path);
            acc.push(...subKeys);
        }

        return acc;
    }, []);
}
