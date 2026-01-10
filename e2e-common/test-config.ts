import { mergeConfig } from '@vendure/core';
import {
    testConfig as defaultTestConfig,
    MysqlInitializer,
    PostgresInitializer,
    registerInitializer,
    SqljsInitializer,
} from '@vendure/testing';
import fs from 'fs-extra';
import path from 'path';
import { DataSourceOptions } from 'typeorm';

import { getPackageDir } from './get-package-dir';

declare global {
    namespace NodeJS {
        interface Global {
            e2eServerPortsUsed: number[];
        }
    }
}

/**
 * We use a relatively long timeout on the initial beforeAll() function of the
 * e2e tests because on the first run (and always in CI) the sqlite databases
 * need to be generated, which can take a while.
 */
export const TEST_SETUP_TIMEOUT_MS = process.env.E2E_DEBUG ? 1800 * 1000 : 120000;

const packageDir = getPackageDir();

registerInitializer('sqljs', new SqljsInitializer(path.join(packageDir, '__data__')));
registerInitializer('postgres', new PostgresInitializer());
registerInitializer('mysql', new MysqlInitializer());
registerInitializer('mariadb', new MysqlInitializer());

export const testConfig = () => {
    const index = getIndexOfTestFileInParentDir();
    return mergeConfig(defaultTestConfig, {
        apiOptions: {
            port: 3010 + index,
        },
        importExportOptions: {
            importAssetsDir: path.join(packageDir, 'fixtures/assets'),
        },
        dbConnectionOptions: getDbConfig(),
    });
};

/**
 * Returns the index of the test file in the parent directory.
 * This is used to ensure each test file has a unique
 * port number.
 */
function getIndexOfTestFileInParentDir() {
    const testFilePath = getCallerFilename(2);
    const parentDir = path.dirname(testFilePath);
    const files = fs.readdirSync(parentDir);
    const index = files.indexOf(path.basename(testFilePath));
    return index;
}

/**
 * Returns the full path to the file which called the function.
 * @param depth
 */
function getCallerFilename(depth: number): string {
    let stack: any;
    let file: any;
    let frame: any;

    const pst = Error.prepareStackTrace;
    Error.prepareStackTrace = (_, _stack) => {
        Error.prepareStackTrace = pst;
        return _stack;
    };

    stack = new Error().stack;
    stack = stack.slice(depth + 1);

    do {
        frame = stack.shift();
        file = frame && frame.getFileName();
    } while (stack.length && file === 'module.js');

    return file;
}

function getDbConfig(): DataSourceOptions {
    const dbType = process.env.DB || 'sqljs';
    switch (dbType) {
        case 'postgres':
            return {
                synchronize: true,
                type: 'postgres',
                host: '127.0.0.1',
                port: process.env.CI ? +(process.env.E2E_POSTGRES_PORT || 5432) : 5432,
                username: 'vendure',
                password: 'password',
                // Connection timeouts to prevent aborted connections
                connectTimeout: 60000,
                // Keep connections alive
                keepConnectionAlive: true,
                extra: {
                    // Connection pool settings
                    max: 10,
                    idleTimeoutMillis: 30000,
                    connectionTimeoutMillis: 60000,
                },
            };
        case 'mariadb':
            return {
                synchronize: true,
                type: 'mariadb',
                host: '127.0.0.1',
                port: process.env.CI ? +(process.env.E2E_MARIADB_PORT || 3306) : 3306,
                username: 'vendure',
                password: 'password',
                extra: {
                    // Ensure tables use InnoDB for locking support
                    initSql: "SET default_storage_engine=InnoDB;",
                    // Connection pool settings
                    connectionLimit: 10,
                    waitForConnections: true,
                    queueLimit: 0,
                },
                // Connection timeouts to prevent aborted connections
                connectTimeout: 60000,
                acquireTimeout: 60000,
                // Keep connections alive
                keepConnectionAlive: true,
            };
        case 'mysql':
            return {
                synchronize: true,
                type: 'mysql',
                host: '127.0.0.1',
                port: process.env.CI ? +(process.env.E2E_MYSQL_PORT || 3306) : 3306,
                username: 'vendure',
                password: 'password',
                extra: {
                    // Ensure tables use InnoDB for locking support
                    initSql: "SET default_storage_engine=InnoDB;",
                    // Connection pool settings
                    connectionLimit: 10,
                    waitForConnections: true,
                    queueLimit: 0,
                },
                // Connection timeouts to prevent aborted connections
                connectTimeout: 60000,
                acquireTimeout: 60000,
                // Keep connections alive
                keepConnectionAlive: true,
            };
        case 'sqljs':
        default:
            return defaultTestConfig.dbConnectionOptions;
    }
}
