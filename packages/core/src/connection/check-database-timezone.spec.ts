import { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { checkDatabaseTimezone } from './check-database-timezone';

function fakeDataSource(type: string, row: { tz: string; offset: number }, timezone?: string): DataSource {
    return {
        options: { type, timezone },
        query: async () => [row],
    } as any;
}

const legacy = { entityOptions: { timestampColumnType: 'timestamp' } } as any;

describe('checkDatabaseTimezone()', () => {
    it('postgres timestamptz: never warns', async () => {
        const warnings = await checkDatabaseTimezone(
            fakeDataSource('postgres', { tz: 'America/Los_Angeles', offset: -28800 }),
            { entityOptions: { timestampColumnType: 'timestamptz' } } as any,
            'Europe/Vienna',
            3600,
        );
        expect(warnings).toEqual([]);
    });

    it('postgres timestamp: warns about a non-UTC session', async () => {
        const warnings = await checkDatabaseTimezone(
            fakeDataSource('postgres', { tz: 'Europe/Vienna', offset: 3600 }),
            legacy,
            'UTC',
            0,
        );
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('session timezone is "Europe/Vienna"');
        expect(warnings[0]).toContain('1h off');
    });

    it('postgres timestamp: warns about a non-UTC process', async () => {
        const warnings = await checkDatabaseTimezone(
            fakeDataSource('postgres', { tz: 'UTC', offset: 0 }),
            legacy,
            'Europe/Vienna',
            3600,
        );
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('Node.js process timezone is "Europe/Vienna"');
    });

    it('postgres timestamp: no warning when process and session are UTC', async () => {
        for (const zone of ['UTC', 'Etc/UTC', 'Etc/GMT']) {
            const warnings = await checkDatabaseTimezone(
                fakeDataSource('postgres', { tz: 'Etc/UTC', offset: 0 }),
                legacy,
                zone,
                0,
            );
            expect(warnings).toEqual([]);
        }
    });

    it('aurora-postgres is checked like postgres', async () => {
        const warnings = await checkDatabaseTimezone(
            fakeDataSource('aurora-postgres', { tz: 'UTC', offset: 0 }),
            legacy,
            'America/Los_Angeles',
            -28800,
        );
        expect(warnings).toHaveLength(1);
    });

    it("mysql with timezone 'Z' and a non-UTC session time_zone: warns", async () => {
        const warnings = await checkDatabaseTimezone(
            fakeDataSource('mysql', { tz: 'Europe/Vienna', offset: 3600 }, 'Z'),
            {} as any,
            'UTC',
            0,
        );
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('1h off');
    });

    it("mysql with timezone 'Z' and a UTC session: no warning", async () => {
        const warnings = await checkDatabaseTimezone(
            fakeDataSource('mysql', { tz: '+00:00', offset: 0 }, 'Z'),
            {} as any,
            'Europe/Vienna',
            3600,
        );
        expect(warnings).toEqual([]);
    });

    it("mysql with timezone 'local' in a non-UTC process: warns about local storage", async () => {
        const warnings = await checkDatabaseTimezone(
            fakeDataSource('mariadb', { tz: 'Europe/Vienna', offset: 3600 }, 'local'),
            {} as any,
            'Europe/Vienna',
            3600,
        );
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('timezone is "local"');
    });
});
