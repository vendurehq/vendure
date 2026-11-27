import { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { checkBinaryLogFormat } from './check-binary-log-format';

function fakeDataSource(type: string, row: { logBin: number; format: string }, isolationLevel?: string) {
    return { options: { type, isolationLevel }, query: async () => [row] } as unknown as DataSource;
}

const noConfig = { entityOptions: {} } as any;

describe('checkBinaryLogFormat()', () => {
    it('warns on MySQL and MariaDB when statement-based binary logging would reject READ COMMITTED writes', async () => {
        for (const type of ['mysql', 'mariadb']) {
            const warnings = await checkBinaryLogFormat(
                fakeDataSource(type, { logBin: 1, format: 'STATEMENT' }),
                noConfig,
            );
            expect(warnings).toHaveLength(1);
            expect(warnings[0]).toContain('binlog_format');
        }
    });

    it('does not warn for row-based or mixed logging, or with binary logging off', async () => {
        for (const row of [
            { logBin: 1, format: 'ROW' },
            { logBin: 1, format: 'MIXED' },
            { logBin: 0, format: 'STATEMENT' },
        ]) {
            expect(await checkBinaryLogFormat(fakeDataSource('mysql', row), noConfig)).toEqual([]);
        }
    });

    it('does not warn when transactions are configured to run at another level', async () => {
        const row = { logBin: 1, format: 'STATEMENT' };
        expect(
            await checkBinaryLogFormat(fakeDataSource('mysql', row), {
                entityOptions: { transactionIsolationLevel: 'REPEATABLE READ' },
            } as any),
        ).toEqual([]);
        expect(await checkBinaryLogFormat(fakeDataSource('mysql', row, 'REPEATABLE READ'), noConfig)).toEqual(
            [],
        );
    });

    it('does not check other databases', async () => {
        const row = { logBin: 1, format: 'STATEMENT' };
        for (const type of ['postgres', 'sqljs', 'aurora-mysql']) {
            expect(await checkBinaryLogFormat(fakeDataSource(type, row), noConfig)).toEqual([]);
        }
    });
});
