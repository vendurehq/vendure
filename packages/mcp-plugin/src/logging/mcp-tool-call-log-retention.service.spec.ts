import { describe, expect, it, vi } from 'vitest';

import { resolveMcpPluginOptions } from '../resolve-options';
import { McpPluginOptions } from '../types';

import { McpToolCallLogRetentionService } from './mcp-tool-call-log-retention.service';

/** Options to steer the delete mock. */
interface RetentionFixtures {
    deleteAffected?: number;
}

function build(options: McpPluginOptions, fixtures: RetentionFixtures = {}) {
    const selectWhere: Array<{ clause: string; params: Record<string, unknown> }> = [];
    // Query-builder mock for the batched retention prune: a SELECT
    // (.select().where().limit().getRawMany()) hands out up to `limit` expired-row ids, then a DELETE
    // (.delete().where('id IN ...').execute()) removes them. `fixtures.deleteAffected` seeds how many
    // expired rows exist so the prune loop drains them and terminates.
    let remainingExpired = fixtures.deleteAffected ?? 0;
    const createQueryBuilder = () => {
        const qb: any = {
            _mode: 'select',
            _limit: undefined as number | undefined,
            _deleteIds: [] as unknown[],
            select: () => {
                qb._mode = 'select';
                return qb;
            },
            delete: () => {
                qb._mode = 'delete';
                return qb;
            },
            where: (clause: string, params: Record<string, unknown>) => {
                if (qb._mode === 'delete') {
                    qb._deleteIds = (params.ids as unknown[]) ?? [];
                } else {
                    selectWhere.push({ clause, params });
                }
                return qb;
            },
            limit: (n: number) => {
                qb._limit = n;
                return qb;
            },
            getRawMany: () => {
                const n = Math.min(remainingExpired, qb._limit ?? remainingExpired);
                return Promise.resolve(Array.from({ length: n }, (_, i) => ({ id: i + 1 })));
            },
            execute: () => {
                remainingExpired -= qb._deleteIds.length;
                return Promise.resolve({ affected: qb._deleteIds.length });
            },
        };
        return qb;
    };
    const getRepository = vi.fn(() => ({ createQueryBuilder }));
    const connection = { getRepository };
    const service = new McpToolCallLogRetentionService(
        connection as any,
        resolveMcpPluginOptions(options),
    );
    return { service, selectWhere, getRepository };
}

describe('McpToolCallLogRetentionService', () => {
    it('deleteExpiredToolCallLogs filters createdAt by the configured ttlDays and returns the count', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-02-01T00:00:00Z'));
        try {
            const { service, selectWhere } = build({ logging: { ttlDays: 10 } }, { deleteAffected: 3 });
            const count = await service.deleteExpiredToolCallLogs({} as any);
            expect(count).toBe(3);
            expect(selectWhere.length).toBeGreaterThanOrEqual(1);
            expect(selectWhere[0].clause).toMatch(/createdAt < :cutoff/);
            const cutoff = selectWhere[0].params.cutoff as Date;
            expect(cutoff.toISOString()).toBe(
                new Date(Date.parse('2026-02-01T00:00:00Z') - 10 * 86_400_000).toISOString(),
            );
        } finally {
            vi.useRealTimers();
        }
    });

    it('deleteExpiredToolCallLogs keeps every row and runs no query when ttlDays is 0', async () => {
        const { service, getRepository } = build({ logging: { ttlDays: 0 } }, { deleteAffected: 3 });
        const count = await service.deleteExpiredToolCallLogs({} as any);
        expect(count).toBe(0);
        expect(getRepository).not.toHaveBeenCalled();
    });

    it('deleteExpiredToolCallLogs defaults to a 30-day window and returns 0 when nothing matched', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-02-01T00:00:00Z'));
        try {
            const { service, selectWhere } = build({});
            const count = await service.deleteExpiredToolCallLogs({} as any);
            expect(count).toBe(0);
            const cutoff = selectWhere[0].params.cutoff as Date;
            expect(cutoff.toISOString()).toBe(
                new Date(Date.parse('2026-02-01T00:00:00Z') - 30 * 86_400_000).toISOString(),
            );
        } finally {
            vi.useRealTimers();
        }
    });
});
