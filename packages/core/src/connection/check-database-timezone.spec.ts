import { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { checkDatabaseTimezone } from './check-database-timezone';

function fakeDataSource(type: string, row: { tz: string; offset: number }, timezone?: string): DataSource {
    return {
        options: { type, timezone },
        query: async () => [row],
    } as any;
}

const processIsUtc = ['UTC', 'Etc/UTC'].includes(Intl.DateTimeFormat().resolvedOptions().timeZone);

describe('checkDatabaseTimezone()', () => {
    it('postgres timestamptz: never warns', async () => {
        const warnings = await checkDatabaseTimezone(
            fakeDataSource('postgres', { tz: 'America/Los_Angeles', offset: -28800 }),
            { entityOptions: { timestampColumnType: 'timestamptz' } } as any,
        );
        expect(warnings).toEqual([]);
    });

    it('postgres timestamp: warns about a non-UTC session', async () => {
        const warnings = await checkDatabaseTimezone(
            fakeDataSource('postgres', { tz: 'Europe/Vienna', offset: 3600 }),
            { entityOptions: { timestampColumnType: 'timestamp' } } as any,
        );
        expect(warnings.some(w => w.includes('session timezone is "Europe/Vienna"') && w.includes('1h off'))).toBe(true);
    });

    it('postgres timestamp: warns about a non-UTC process', async () => {
        const warnings = await checkDatabaseTimezone(fakeDataSource('postgres', { tz: 'UTC', offset: 0 }), {
            entityOptions: { timestampColumnType: 'timestamp' },
        } as any);
        expect(warnings.some(w => w.includes('Node.js process timezone'))).toBe(!processIsUtc);
    });

    it("mysql with timezone 'Z' and a non-UTC session time_zone: warns", async () => {
        const warnings = await checkDatabaseTimezone(
            fakeDataSource('mysql', { tz: 'Europe/Vienna', offset: 3600 }, 'Z'),
            {} as any,
        );
        expect(warnings.some(w => w.includes('1h off'))).toBe(true);
    });

    it("mysql with timezone 'Z' and a UTC session: no warning", async () => {
        const warnings = await checkDatabaseTimezone(fakeDataSource('mysql', { tz: '+00:00', offset: 0 }, 'Z'), {} as any);
        expect(warnings).toEqual([]);
    });
});
