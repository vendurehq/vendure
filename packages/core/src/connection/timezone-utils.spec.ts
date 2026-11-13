import { describe, expect, it } from 'vitest';

import { isMysqlDatabase, isPostgresDatabase, isUtcTimezone } from './timezone-utils';

describe('isUtcTimezone()', () => {
    it('recognises UTC names and offsets', () => {
        for (const zone of ['UTC', 'Etc/UTC', 'GMT', 'Etc/GMT', 'Etc/Universal', 'Zulu', 'Z', 'utc', '+00:00', '00:00', '-00', '0']) {
            expect(isUtcTimezone(zone), zone).toBe(true);
        }
    });

    it('rejects other zones', () => {
        for (const zone of ['Europe/London', 'Europe/Vienna', '+01:00', '+05:30', 'local', '', undefined]) {
            expect(isUtcTimezone(zone), String(zone)).toBe(false);
        }
    });
});

describe('database type checks', () => {
    it('treats Aurora like its engine', () => {
        expect(isPostgresDatabase('postgres')).toBe(true);
        expect(isPostgresDatabase('aurora-postgres')).toBe(true);
        expect(isPostgresDatabase('mysql')).toBe(false);
        expect(isMysqlDatabase('mysql')).toBe(true);
        expect(isMysqlDatabase('mariadb')).toBe(true);
        expect(isMysqlDatabase('aurora-mysql')).toBe(true);
        expect(isMysqlDatabase('postgres')).toBe(false);
    });
});
