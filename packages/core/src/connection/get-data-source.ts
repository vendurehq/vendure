import { DataSource } from 'typeorm';

/**
 * @description
 * A TypeORM object which knows the {@link DataSource} it belongs to, such as a QueryBuilder,
 * EntityManager, QueryRunner or EntityMetadata. TypeORM 0.3 names that property `connection`.
 * TypeORM 1 renames it to `dataSource` and keeps `connection` as a deprecated alias on some,
 * but not all, of those classes. Code which has to run on both versions therefore reads the
 * DataSource via {@link getDataSource} rather than naming either property directly.
 *
 * @docsCategory data-access
 * @since 3.8.0
 */
export type DataSourceHolder = { connection?: DataSource; dataSource?: DataSource };

/**
 * @description
 * Returns the {@link DataSource} that the given TypeORM object belongs to, reading whichever of
 * the `dataSource` and `connection` properties the installed version of TypeORM provides. Where
 * an object carries both, `dataSource` is used, since `connection` is the deprecated alias.
 *
 * @example
 * ```ts
 * const collectionFilter = new CollectionFilter({
 *   // ...
 *   apply: (qb, args) => {
 *     const LIKE = getDataSource(qb).options.type === 'postgres' ? 'ILIKE' : 'LIKE';
 *     return qb.andWhere(`productVariant.sku ${LIKE} :sku`, { sku: `%${args.sku}%` });
 *   },
 * });
 * ```
 *
 * @docsCategory data-access
 * @since 3.8.0
 */
export function getDataSource(source: DataSourceHolder): DataSource {
    // Without these checks the caller fails further on with "cannot read properties of undefined".
    if (source == null) {
        throw new Error(`Could not resolve a TypeORM DataSource from ${String(source)}.`);
    }
    const dataSource = source.dataSource ?? source.connection;
    if (!dataSource) {
        throw new Error(
            `Could not resolve a TypeORM DataSource from a ${
                source.constructor?.name ?? typeof source
            }: it has neither a "dataSource" nor a "connection" property.`,
        );
    }
    return dataSource;
}
