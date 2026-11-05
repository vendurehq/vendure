import { DataSource, DataSourceOptions } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { getDatabaseType } from './database-type';

describe('getDatabaseType()', () => {
    it('reads the type from DataSourceOptions', () => {
        expect(getDatabaseType({ type: 'postgres' } as DataSourceOptions)).toBe('postgres');
    });

    it('reads the type from a DataSource', () => {
        expect(getDatabaseType({ options: { type: 'better-sqlite3' } } as DataSource)).toBe('better-sqlite3');
    });

    // The mssql driver options carry an `options` property of their own, which must not be
    // mistaken for the `options` of a DataSource.
    it('reads the type from mssql options rather than their nested options bag', () => {
        const options = { type: 'mssql', options: { instanceName: 'main' } } as DataSourceOptions;
        expect(getDatabaseType(options)).toBe('mssql');
    });

    // `sqlite` is declared by some TypeORM versions and not others, but a project may be
    // configured with it either way, so it has to survive the round trip.
    it('preserves the sqlite driver name', () => {
        expect(getDatabaseType({ type: 'sqlite' } as DataSourceOptions)).toBe('sqlite');
    });
});
