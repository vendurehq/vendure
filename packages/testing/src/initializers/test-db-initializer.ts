import { DataSourceOptions } from 'typeorm';
import { BaseConnectionOptions } from 'typeorm/connection/BaseConnectionOptions';

/**
 * @description
 * Defines how the e2e TestService sets up a particular DB to run a single test suite.
 * The `\@vendure/testing` package ships with initializers for sql.js, MySQL & Postgres.
 *
 * Custom initializers can be created by implementing this interface and registering
 * it with the {@link registerInitializer} function:
 *
 * @example
 * ```ts
 * export class CockroachDbInitializer implements TestDbInitializer<CockroachConnectionOptions> {
 *     // database-specific implementation goes here
 * }
 *
 * registerInitializer('cockroachdb', new CockroachDbInitializer());
 * ```
 *
 * @docsCategory testing
 */
export interface TestDbInitializer<T extends BaseConnectionOptions> {
    /**
     * @description
     * Responsible for creating a database for the current test suite.
     * Typically, this method will:
     *
     * * use the testFileName parameter to derive a database name
     * * create the database
     * * mutate the `connetionOptions` object to point to that new database
     */
    init(testFileName: string, connectionOptions: T): Promise<T>;

    /**
     * @description
     * Execute the populateFn to populate your database.
     */
    populate(populateFn: () => Promise<void>): Promise<void>;

    /**
     * @description
     * Clean up any resources used during the init() phase (i.e. close open DB connections)
     */
    destroy(): void | Promise<void>;
}
