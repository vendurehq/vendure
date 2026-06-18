import { ResultOf, TypedDocumentNode } from '@graphql-typed-document-node/core';

// Type that identifies a paginated list structure (has items array and totalItems)
type IsEntity<T> = T extends { id: string } ? true : false;

// Helper type to extract string keys from an object
type StringKeys<T> = T extends object ? Extract<keyof T, string> : never;

/**
 * @description
 * This type is used to extract the path to the entity from the query result.
 *
 * For example, if you have a query like this:
 *
 * ```graphql
 * query GetEntity($id: ID!) {
 *   entity(id: $id) {
 *     id
 *     name
 *   }
 * }
 * ```
 *
 * The `DetailEntityPath` type will be `'entity'`.
 */
export type DetailEntityPath<T extends TypedDocumentNode<any, any>> = {
    [K in StringKeys<ResultOf<T>>]: NonNullable<ResultOf<T>[K]> extends object
        ? IsEntity<NonNullable<ResultOf<T>[K]>> extends true
            ? K
            : never
        : never;
}[StringKeys<ResultOf<T>>];

/**
 * @description
 * This type is used to extract the entity from the query result.
 *
 * For example, if you have a query like this:
 *
 * ```graphql
 * query GetEntity($id: ID!) {
 *   entity(id: $id) {
 *     id
 *     name
 *   }
 * }

 * ```
 * The `DetailEntity` type will be `{ id: string, name: string }`.
 */
export type DetailEntity<T extends TypedDocumentNode<any, any>> = ResultOf<T>[DetailEntityPath<T>];
