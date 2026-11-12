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
import { getTestFileIndex } from './get-test-file-index';

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
    const testFilePath = getCallerFilename(1);
    const index = getTestFileIndex(path.dirname(packageDir), testFilePath);
    const { basePort, size } = getPortRange();
    if (index === -1) {
        throw new Error(`${testFilePath} is not a test file of ${path.dirname(packageDir)}.`);
    }
    if (index >= size) {
        throw new Error(
            `${path.dirname(packageDir)} has more than ${size} test files. Make its port range in e2e-common/test-config.ts larger.`,
        );
    }
    return mergeConfig(defaultTestConfig, {
        apiOptions: {
            port: basePort + index,
        },
        importExportOptions: {
            importAssetsDir: path.join(packageDir, 'fixtures/assets'),
        },
        dbConnectionOptions: getDbConfig(),
    });
};

const CORE_BASE_PORT = 3010;
/** Core has the most e2e specs. Its range ends at 3199. */
const CORE_PORTS = 190;
/**
 * The other packages get ports from here. The ports are far from the ports of the services in
 * `docker-compose.yml`, and below the ephemeral port range of Linux and macOS.
 */
const PACKAGE_BASE_PORT = 20000;
const PORTS_PER_PACKAGE = 50;

/**
 * Returns a port range unique to the current package, so that e2e tests
 * from different packages (which Nx may run in parallel) never collide.
 * Each package other than core gets PORTS_PER_PACKAGE ports, in the order of the folder
 * names in `packages`. A new package moves the ranges after it. That is safe, because
 * the ports only have to be unique in one checkout.
 */
function getPortRange(): { basePort: number; size: number } {
    const packageName = path.basename(path.dirname(packageDir));
    if (packageName === 'core') {
        return { basePort: CORE_BASE_PORT, size: CORE_PORTS };
    }
    const packages = fs
        .readdirSync(path.dirname(path.dirname(packageDir)))
        .filter(name => name !== 'core')
        .sort((a, b) => a.localeCompare(b));
    return {
        basePort: PACKAGE_BASE_PORT + packages.indexOf(packageName) * PORTS_PER_PACKAGE,
        size: PORTS_PER_PACKAGE,
    };
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

export function getDbConfig(): DataSourceOptions {
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
