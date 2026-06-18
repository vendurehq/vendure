import { InitialData } from '@vendure/core';

/**
 * Creates a mutable version of a type with readonly properties.
 */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * @description
 * Configuration options used to initialize an instance of the {@link TestServer}.
 *
 * @docsCategory testing
 */
export interface TestServerOptions {
    /**
     * @description
     * The path to an optional CSV file containing product data to import.
     */
    productsCsvPath?: string;
    /**
     * @description
     * An object containing non-product data which is used to populate the database.
     */
    initialData: InitialData;
    /**
     * @description
     * The number of fake Customers to populate into the database.
     *
     * @default 10
     */
    customerCount?: number;
    /**
     * @description
     * Set this to `true` to log some information about the database population process.
     *
     * @default false
     */
    logging?: boolean;
}

export type QueryParams = { [key: string]: string | number };
