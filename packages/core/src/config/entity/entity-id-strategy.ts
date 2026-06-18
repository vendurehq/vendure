import { InjectableStrategy } from '../../common/types/injectable-strategy';

export type PrimaryKeyType<T> = T extends 'uuid' ? string : T extends 'increment' ? number : any;

/**
 * @description
 * The EntityIdStrategy determines how entity IDs are generated and stored in the
 * database, as well as how they are transformed when being passed from the API to the
 * service layer and vice versa.
 *
 * Vendure ships with two strategies: {@link AutoIncrementIdStrategy} and {@link UuidIdStrategy},
 * but custom strategies can be used, e.g. to apply some custom encoding to the ID before exposing
 * it in the GraphQL API.
 *
 * :::info
 *
 * This is configured via the `entityOptions.entityIdStrategy` property of
 * your VendureConfig.
 *
 * :::
 *
 * :::caution
 * Note: changing from an integer-based strategy to a uuid-based strategy
 * on an existing Vendure database will lead to problems with broken foreign-key
 * references. To change primary key types like this, you'll need to start with
 * a fresh database.
 * :::
 *
 * @docsCategory configuration
 * @docsPage EntityIdStrategy
 * */
export interface EntityIdStrategy<T extends 'increment' | 'uuid'> extends InjectableStrategy {
    /**
     * @description
     * Defines how the primary key will be stored in the database - either
     * `'increment'` for auto-increment integer IDs, or `'uuid'` for a unique
     * string ID.
     */
    readonly primaryKeyType: T;
    /**
     * @description
     * Allows the raw ID from the database to be transformed in some way before exposing
     * it in the GraphQL API.
     *
     * For example, you may need to use auto-increment integer IDs due to some business
     * constraint, but you may not want to expose this data publicly in your API. In this
     * case, you can use the encode/decode methods to obfuscate the ID with some kind of
     * encoding scheme, such as base64 (or something more sophisticated).
     */
    encodeId: (primaryKey: PrimaryKeyType<T>) => string;
    /**
     * @description
     * Reverses the transformation performed by the `encodeId` method in order to get
     * back to the raw ID value.
     */
    decodeId: (id: string) => PrimaryKeyType<T>;
}
