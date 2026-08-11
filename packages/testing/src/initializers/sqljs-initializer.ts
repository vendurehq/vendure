import fs from 'fs';
import path from 'path';

import { Mutable } from '../types';

import { DriverOptions, TestDbInitializer } from './test-db-initializer';

export class SqljsInitializer implements TestDbInitializer<DriverOptions<'sqljs'>> {
    private dbFilePath: string;
    private connectionOptions: DriverOptions<'sqljs'>;

    /**
     * @param dataDir
     * @param postPopulateTimeoutMs Allows you to specify a timeout to wait after the population
     * step and before the server is shut down. Can resolve occasional race condition issues with
     * the job queue.
     */
    constructor(private dataDir: string, private postPopulateTimeoutMs: number = 0) {}

    async init(
        testFileName: string,
        connectionOptions: DriverOptions<'sqljs'>,
    ): Promise<DriverOptions<'sqljs'>> {
        this.dbFilePath = this.getDbFilePath(testFileName);
        this.connectionOptions = connectionOptions;
        (connectionOptions as Mutable<DriverOptions<'sqljs'>>).location = this.dbFilePath;
        return connectionOptions;
    }

    async populate(populateFn: () => Promise<void>): Promise<void> {
        if (!fs.existsSync(this.dbFilePath)) {
            const dirName = path.dirname(this.dbFilePath);
            if (!fs.existsSync(dirName)) {
                fs.mkdirSync(dirName);
            }
            (this.connectionOptions as Mutable<DriverOptions<'sqljs'>>).autoSave = true;
            (this.connectionOptions as Mutable<DriverOptions<'sqljs'>>).synchronize = true;
            await populateFn();
            await new Promise(resolve => setTimeout(resolve, this.postPopulateTimeoutMs));
            (this.connectionOptions as Mutable<DriverOptions<'sqljs'>>).autoSave = false;
            (this.connectionOptions as Mutable<DriverOptions<'sqljs'>>).synchronize = false;
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
