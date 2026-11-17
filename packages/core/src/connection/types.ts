import { ID } from '@vendure/common/lib/shared-types';
import { FindManyOptions, FindOneOptions, FindOptionsRelations, FindOptionsSelect } from 'typeorm';

/**
 * @description
 * The relations to join when finding an entity. Accepts either the TypeORM object form,
 * or an array of dot-separated relation paths as produced by {@link RelationPaths}.
 *
 * @docsCategory data-access
 * @since 3.8.0
 */
export type FindOptionsRelationsInput<T> = FindOptionsRelations<T> | string[];

/**
 * @description
 * The columns to select when finding an entity. Accepts either the TypeORM object form,
 * or an array of column names.
 *
 * @docsCategory data-access
 * @since 3.8.0
 */
export type FindOptionsSelectInput<T> = FindOptionsSelect<T> | string[];

/**
 * @description
 * The TypeORM `FindOneOptions`, with `relations` and `select` also accepting an array of
 * paths.
 *
 * @docsCategory data-access
 * @since 3.8.0
 */
export interface VendureFindOneOptions<T = any> extends Omit<FindOneOptions<T>, 'relations' | 'select'> {
    relations?: FindOptionsRelationsInput<T>;
    select?: FindOptionsSelectInput<T>;
}

/**
 * @description
 * The TypeORM `FindManyOptions`, with `relations` and `select` also accepting an array of
 * paths.
 *
 * @docsCategory data-access
 * @since 3.8.0
 */
export interface VendureFindManyOptions<T = any> extends Omit<FindManyOptions<T>, 'relations' | 'select'> {
    relations?: FindOptionsRelationsInput<T>;
    select?: FindOptionsSelectInput<T>;
}

/**
 * @description
 * Options used by the {@link TransactionalConnection} `getEntityOrThrow` method.
 *
 * @docsCategory data-access
 */
export interface GetEntityOrThrowOptions<T = any> extends VendureFindOneOptions<T> {
    /**
     * @description
     * An optional channelId to limit results to entities assigned to the given Channel. Should
     * only be used when getting entities that implement the {@link ChannelAware} interface.
     */
    channelId?: ID;
    /**
     * @description
     * If set to a positive integer, it will retry getting the entity in case it is initially not
     * found.
     *
     * @since 1.1.0
     * @default 0
     */
    retries?: number;
    /**
     * @description
     * Specifies the delay in ms to wait between retries.
     *
     * @since 1.1.0
     * @default 25
     */
    retryDelay?: number;
    /**
     * @description
     * If set to `true`, soft-deleted entities will be returned. Otherwise they will
     * throw as if they did not exist.
     *
     * @since 1.3.0
     * @default false
     */
    includeSoftDeleted?: boolean;
}
