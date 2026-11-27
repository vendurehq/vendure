import { DataSource } from 'typeorm';

import { Logger } from '../config/logger/vendure-logger';
import { VendureConfig } from '../config/vendure-config';

import { getDatabaseType } from './database-type';

const loggerCtx = 'BinaryLogFormat';

/**
 * @description
 * On MySQL and MariaDB, Vendure runs transactions at `READ COMMITTED` unless configured otherwise.
 * With binary logging on and `binlog_format=STATEMENT`, the server rejects every write at that level,
 * so this logs an error naming the fix at startup, rather than leaving it to the first write.
 *
 * Aurora MySQL is not checked: TypeORM's Aurora MySQL driver never applies an isolation level.
 *
 * Returns the warnings so that it can be tested.
 */
export async function checkBinaryLogFormat(dataSource: DataSource, config: VendureConfig): Promise<string[]> {
    const dbType = getDatabaseType(dataSource);
    if (dbType !== 'mysql' && dbType !== 'mariadb') {
        return [];
    }
    const configured =
        config.entityOptions?.transactionIsolationLevel ??
        (dataSource.options as { isolationLevel?: string }).isolationLevel;
    if (configured && configured !== 'READ COMMITTED' && configured !== 'READ UNCOMMITTED') {
        return [];
    }
    const warnings: string[] = [];
    try {
        const [row] = await dataSource.query(
            'SELECT @@GLOBAL.log_bin AS logBin, @@SESSION.binlog_format AS format',
        );
        if (Number(row?.logBin) === 1 && String(row?.format).toUpperCase() === 'STATEMENT') {
            warnings.push(
                'Binary logging uses binlog_format=STATEMENT, which rejects writes made at READ COMMITTED, ' +
                    'the isolation level Vendure runs MySQL and MariaDB transactions at. Set binlog_format to ' +
                    'ROW or MIXED on the database server. See the "Order concurrency" page of the v4 migration guide.',
            );
        }
    } catch (e: any) {
        Logger.debug(`Could not check the binary log format: ${String(e?.message)}`, loggerCtx);
    }
    for (const warning of warnings) {
        Logger.error(warning, loggerCtx);
    }
    return warnings;
}
