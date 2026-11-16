import { FindOptionsRelations, FindOptionsSelect } from 'typeorm';

import { findOptionsArrayToObject } from './find-options-array-to-object';
import { VendureFindManyOptions } from './types';

/**
 * @description
 * The find options `O` with its `relations` and `select` properties narrowed to the object
 * form that TypeORM accepts.
 *
 * @docsCategory data-access
 * @since 3.8.0
 */
export type TypeOrmFindOptions<T, O> = Omit<O, 'relations' | 'select'> & {
    relations?: FindOptionsRelations<T>;
    select?: FindOptionsSelect<T>;
};

/**
 * @description
 * Converts the `relations` and `select` properties of Vendure's find options into the object
 * form TypeORM expects. Call this wherever find options cross from a Vendure API into TypeORM.
 *
 * Vendure's own APIs accept relation paths as a string array, since that is the shape of
 * {@link RelationPaths} and of the `@Relations()` decorator that produces it. TypeORM only
 * accepts the object form.
 *
 * @docsCategory data-access
 * @since 3.8.0
 */
export function toTypeOrmFindOptions<T, O extends VendureFindManyOptions<T>>(
    options: O,
): TypeOrmFindOptions<T, O> {
    const { relations, select, ...rest } = options;
    return {
        ...rest,
        ...(relations !== undefined && {
            relations: Array.isArray(relations) ? findOptionsArrayToObject<T>(relations) : relations,
        }),
        ...(select !== undefined && {
            select: Array.isArray(select)
                ? (findOptionsArrayToObject<T>(select) as FindOptionsSelect<T>)
                : select,
        }),
    } as TypeOrmFindOptions<T, O>;
}
