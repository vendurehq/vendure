import { VendureDatabaseType } from './database-type';

const UTC_ZONES = new Set([
    'UTC',
    'Etc/UTC',
    'Etc/UCT',
    'UCT',
    'GMT',
    'Etc/GMT',
    'Etc/GMT0',
    'Etc/GMT+0',
    'Etc/GMT-0',
    'GMT0',
    'Etc/Universal',
    'Universal',
    'Etc/Zulu',
    'Zulu',
]);

/**
 * @description
 * Whether an IANA timezone name or a UTC offset (`'Z'`, `'+00:00'`, `'0'`) denotes UTC.
 */
export function isUtcTimezone(zone: string | undefined): boolean {
    if (!zone) {
        return false;
    }
    return UTC_ZONES.has(zone) || zone === 'Z' || zone.toLowerCase() === 'utc' || /^[+-]?0{1,2}(:?00)?$/.test(zone);
}

/**
 * @description
 * Whether the driver talks to Postgres, including Aurora Postgres.
 */
export function isPostgresDatabase(type: VendureDatabaseType | string | undefined): boolean {
    return type === 'postgres' || type === 'aurora-postgres';
}

/**
 * @description
 * Whether the driver talks to MySQL or MariaDB, including Aurora MySQL.
 */
export function isMysqlDatabase(type: VendureDatabaseType | string | undefined): boolean {
    return type === 'mysql' || type === 'mariadb' || type === 'aurora-mysql';
}
