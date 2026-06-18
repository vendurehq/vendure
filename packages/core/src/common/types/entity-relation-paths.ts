import { VendureEntity } from '../../entity/base/base.entity';

import { Translation } from './locale-types';

/**
 * @description
 * This type allows type-safe access to entity relations using strings with dot notation.
 * It works to 2 levels deep.
 *
 * @example
 * ```ts
 * type T1 = EntityRelationPaths<Product>;
 * ```
 * In the above example, the type `T1` will be a string union of all relations of the
 * `Product` entity:
 *
 *  * `'featuredAsset'`
 *  * `'variants'`
 *  * `'variants.options'`
 *  * `'variants.featuredAsset'`
 *  * etc.
 *
 * @docsCategory Common
 */
export type EntityRelationPaths<T extends VendureEntity> =
    | `customFields.${string}`
    | PathsToStringProps1<T>
    | Join<PathsToStringProps2<T>, '.'>
    | TripleDotPath;

export type EntityRelationKeys<T extends VendureEntity> = {
    [K in Extract<keyof T, string>]: Required<T>[K] extends VendureEntity | Translation<VendureEntity> | null
        ? K
        : Required<T>[K] extends VendureEntity[] | Array<Translation<VendureEntity>>
          ? K
          : never;
}[Extract<keyof T, string>];

export type EntityRelations<T extends VendureEntity> = {
    [K in EntityRelationKeys<T>]: T[K];
};

export type PathsToStringProps1<T extends VendureEntity> = T extends string
    ? []
    : {
          [K in EntityRelationKeys<T>]: K;
      }[Extract<EntityRelationKeys<T>, string>];

export type PathsToStringProps2<T extends VendureEntity> = T extends string
    ? never
    : {
          [K in EntityRelationKeys<T>]: T[K] extends VendureEntity[]
              ? [K, PathsToStringProps1<T[K][number]>]
              : T[K] extends VendureEntity | undefined
                ? [K, PathsToStringProps1<NonNullable<T[K]>>]
                : never;
      }[Extract<EntityRelationKeys<T>, string>];

export type TripleDotPath = `${string}.${string}.${string}`;

// Based on https://stackoverflow.com/a/47058976/772859
export type Join<T extends Array<string | any>, D extends string> = T extends []
    ? never
    : T extends [infer F]
      ? F
      : // eslint-disable-next-line no-shadow,@typescript-eslint/no-shadow
        T extends [infer F, ...infer R]
        ? F extends string
            ? `${F}${D}${Join<Extract<R, string[]>, D>}`
            : never
        : string;
