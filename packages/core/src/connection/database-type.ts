import { DataSource, DataSourceOptions } from 'typeorm';

/**
 * @description
 * The name of the TypeORM driver a Vendure project is configured with.
 *
 * This is TypeORM's own driver union widened with `sqlite`, which some TypeORM versions
 * declare and others do not, even though a project may be configured with it either way.
 * Switching on a driver name should use this type rather than `DataSourceOptions['type']`,
 * so that the `sqlite` branches stay reachable.
 *
 * @docsCategory data-access
 * @since 3.8.0
 */
export type VendureDatabaseType = DataSourceOptions['type'] | 'sqlite';

/**
 * @description
 * Returns the name of the TypeORM driver in use, widened to {@link VendureDatabaseType}.
 *
 * @docsCategory data-access
 * @since 3.8.0
 */
export function getDatabaseType(source: DataSource | DataSourceOptions): VendureDatabaseType {
    // Discriminated on `type` rather than `options`, because the mssql driver options carry
    // an `options` property of their own. Checked structurally rather than with `instanceof`,
    // so that a DataSource created by a second copy of TypeORM is still recognised.
    const options = 'type' in source ? source : source.options;
    return options.type as VendureDatabaseType;
}
