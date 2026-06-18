import path from 'path';
import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

import { TestDbInitializer } from './test-db-initializer';

export class PostgresInitializer implements TestDbInitializer<PostgresConnectionOptions> {
    private client: import('pg').Client;

    async init(
        testFileName: string,
        connectionOptions: PostgresConnectionOptions,
    ): Promise<PostgresConnectionOptions> {
        const dbName = this.getDbNameFromFilename(testFileName);
        (connectionOptions as any).database = dbName;
        (connectionOptions as any).synchronize = true;
        this.client = await this.getPostgresConnection(connectionOptions);
        await this.client.query(`DROP DATABASE IF EXISTS ${dbName}`);
        await this.client.query(`CREATE DATABASE ${dbName}`);
        return connectionOptions;
    }

    async populate(populateFn: () => Promise<void>): Promise<void> {
        await populateFn();
    }

    destroy(): void | Promise<void> {
        return this.client.end();
    }

    private async getPostgresConnection(
        connectionOptions: PostgresConnectionOptions,
    ): Promise<import('pg').Client> {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Client } = require('pg');
        const client = new Client({
            host: connectionOptions.host,
            port: connectionOptions.port,
            user: connectionOptions.username,
            password: connectionOptions.password,
            database: 'postgres',
        });
        await client.connect();
        return client;
    }

    private getDbNameFromFilename(filename: string): string {
        return 'e2e_' + path.basename(filename).replace(/[^a-z0-9_]/gi, '_');
    }
}
