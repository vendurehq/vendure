import path from 'path';

import { DriverOptions, TestDbInitializer } from './test-db-initializer';

export class MysqlInitializer implements TestDbInitializer<DriverOptions<'mysql' | 'mariadb'>> {
    private conn: import('mysql2/promise').Connection;

    async init(
        testFileName: string,
        connectionOptions: DriverOptions<'mysql' | 'mariadb'>,
    ): Promise<DriverOptions<'mysql' | 'mariadb'>> {
        const dbName = this.getDbNameFromFilename(testFileName);
        this.conn = await this.getMysqlConnection(connectionOptions);
        (connectionOptions as any).database = dbName;
        (connectionOptions as any).synchronize = true;
        await this.conn.query(`DROP DATABASE IF EXISTS ${dbName}`);
        await this.conn.query(`CREATE DATABASE IF NOT EXISTS ${dbName}`);
        return connectionOptions;
    }

    async populate(populateFn: () => Promise<void>): Promise<void> {
        await populateFn();
    }

    async destroy() {
        await this.conn.end();
    }

    private async getMysqlConnection(
        connectionOptions: DriverOptions<'mysql' | 'mariadb'>,
    ): Promise<import('mysql2/promise').Connection> {
        const { createConnection } = await import('mysql2/promise');
        const conn = createConnection({
            host: connectionOptions.host,
            port: connectionOptions.port,
            user: connectionOptions.username,
            password: connectionOptions.password,
        });
        return conn;
    }

    private getDbNameFromFilename(filename: string): string {
        return 'e2e_' + path.basename(filename).replace(/[^a-z0-9_]/gi, '_');
    }
}
