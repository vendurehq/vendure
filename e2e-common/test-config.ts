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
            port: getBasePort() + index,
        },
        importExportOptions: {
            importAssetsDir: path.join(packageDir, 'fixtures/assets'),
        },
        dbConnectionOptions: getDbConfig(),
    });
};

/**
 * Returns a base port unique to the current package, so that e2e tests
 * from different packages (which Lerna may run in parallel) never collide.
 * Core gets 3010–3199, other packages get 3200+.
 */
function getBasePort(): number {
    const packageName = process.env.PACKAGE || 'core';
    const offsets: Record<string, number> = {
        core: 3010,
        'asset-server-plugin': 3220,
        'graphiql-plugin': 3230,
        cli: 3240,
    };
    return offsets[packageName] ?? 3250;
}

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
            };
        case 'mariadb':
            return {
                synchronize: true,
                type: 'mariadb',
                host: '127.0.0.1',
                port: process.env.CI ? +(process.env.E2E_MARIADB_PORT || 3306) : 3306,
                username: 'root',
                password: 'password',
            };
        case 'mysql':
            return {
                synchronize: true,
                type: 'mysql',
                host: '127.0.0.1',
                port: process.env.CI ? +(process.env.E2E_MYSQL_PORT || 3306) : 3306,
                username: 'root',
                password: 'password',
            };
        case 'sqljs':
        default:
            return defaultTestConfig.dbConnectionOptions;
    }
}
