import { ID } from '@vendure/common/lib/shared-types';
import { FindOneOptions } from 'typeorm';

/**
 * @description
 * Options used by the {@link TransactionalConnection} `getEntityOrThrow` method.
 *
 * @docsCategory data-access
 */
export interface GetEntityOrThrowOptions<T = any> extends FindOneOptions<T> {
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
