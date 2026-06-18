import fs from 'fs';
import path from 'path';
import { SqljsConnectionOptions } from 'typeorm/driver/sqljs/SqljsConnectionOptions';

import { Mutable } from '../types';

import { TestDbInitializer } from './test-db-initializer';

export class SqljsInitializer implements TestDbInitializer<SqljsConnectionOptions> {
    private dbFilePath: string;
    private connectionOptions: SqljsConnectionOptions;

    /**
     * @param dataDir
     * @param postPopulateTimeoutMs Allows you to specify a timeout to wait after the population
     * step and before the server is shut down. Can resolve occasional race condition issues with
     * the job queue.
     */
    constructor(private dataDir: string, private postPopulateTimeoutMs: number = 0) {}

    async init(
        testFileName: string,
        connectionOptions: SqljsConnectionOptions,
    ): Promise<SqljsConnectionOptions> {
        this.dbFilePath = this.getDbFilePath(testFileName);
        this.connectionOptions = connectionOptions;
        (connectionOptions as Mutable<SqljsConnectionOptions>).location = this.dbFilePath;
        return connectionOptions;
    }

    async populate(populateFn: () => Promise<void>): Promise<void> {
        if (!fs.existsSync(this.dbFilePath)) {
            const dirName = path.dirname(this.dbFilePath);
            if (!fs.existsSync(dirName)) {
                fs.mkdirSync(dirName);
            }
            (this.connectionOptions as Mutable<SqljsConnectionOptions>).autoSave = true;
            (this.connectionOptions as Mutable<SqljsConnectionOptions>).synchronize = true;
            await populateFn();
            await new Promise(resolve => setTimeout(resolve, this.postPopulateTimeoutMs));
            (this.connectionOptions as Mutable<SqljsConnectionOptions>).autoSave = false;
            (this.connectionOptions as Mutable<SqljsConnectionOptions>).synchronize = false;
        }
    }

    destroy(): void | Promise<void> {
        return undefined;
    }

    private getDbFilePath(testFileName: string) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const dbFileName = path.basename(testFileName) + '.sqlite';
        const dbFilePath = path.join(this.dataDir, dbFileName);
        return dbFilePath;
    }
}
