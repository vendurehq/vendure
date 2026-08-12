import { Logger } from '@vendure/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { McpToolCallLog } from '../entities/mcp-tool-call-log.entity';
import { McpToolCallEvent } from '../events/mcp-tool-call.event';
import { resolveMcpPluginOptions } from '../resolve-options';
import { McpPluginOptions } from '../types';

import { McpToolCallLogService } from './mcp-tool-call-log.service';

/** Options to steer the persistence / event-publish / delete mocks. */
interface LoggingFailures {
    saveThrows?: boolean;
    publishThrows?: boolean;
    deleteAffected?: number;
}

function build(options: McpPluginOptions, failures: LoggingFailures = {}) {
    const savedLogs: McpToolCallLog[] = [];
    const publishedEvents: McpToolCallEvent[] = [];
    const selectWhere: Array<{ clause: string; params: Record<string, unknown> }> = [];
    const deleteWhere: Array<{ clause: string; params: Record<string, unknown> }> = [];
    const save = vi.fn((entity: McpToolCallLog) => {
        if (failures.saveThrows) {
            return Promise.reject(new Error('save failed'));
        }
        entity.id = savedLogs.length + 1;
        savedLogs.push(entity);
        return Promise.resolve(entity);
    });
    // Query-builder mock for the batched retention prune: a SELECT
    // (.select().where().limit().getRawMany()) hands out up to `limit` expired-row ids, then a DELETE
    // (.delete().where('id IN ...').execute()) removes them. `failures.deleteAffected` seeds how many
    // expired rows exist so the prune loop drains them and terminates.
    let remainingExpired = failures.deleteAffected ?? 0;
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
                    deleteWhere.push({ clause, params });
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
    const connection = { getRepository: () => ({ save, createQueryBuilder }) };
    const publish = vi.fn((event: McpToolCallEvent) => {
        if (failures.publishThrows) {
            return Promise.reject(new Error('subscriber failed'));
        }
        publishedEvents.push(event);
        return Promise.resolve();
    });
    const eventBus = { publish };
    const service = new McpToolCallLogService(
        connection as any,
        eventBus as any,
        resolveMcpPluginOptions(options),
    );
    return { service, savedLogs, publishedEvents, selectWhere, deleteWhere, save, publish };
}

/** Minimal registered-tool stand-in for the logger (only name/pluginSource are read). */
function toolStub(name: string, pluginSource: string | null = 'TestPlugin') {
    return { name, pluginSource } as any;
}

describe('McpToolCallLogService tool-call logging', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => {
        warnSpy.mockRestore();
    });

    it('does not store input/output under the default metadata capture', async () => {
        const { service, savedLogs } = build({});
        await service.logToolCall({
            executionContext: { ctx: { apiType: 'shop', channelId: 1 } } as any,
            tool: toolStub('t'),
            input: { email: 'a@b.com', note: 'hi' },
            output: { customer: { emailAddress: 'a@b.com' } },
            durationMs: 1,
            status: 'success',
        });
        // Metadata capture is the default: the row carries no request/response bodies at all.
        expect(savedLogs[0].input).toBeNull();
        expect(savedLogs[0].output).toBeNull();
    });

    it("stores raw input/output verbatim when capture is 'full' and no redact function is set", async () => {
        const { service, savedLogs } = build({ logging: { capture: 'full' } });
        const input = { email: 'a@b.com', nested: { password: 'p' } };
        const output = { token: 'shown' };
        await service.logToolCall({
            executionContext: { ctx: { apiType: 'shop', channelId: 1 } } as any,
            tool: toolStub('t'),
            input,
            output,
            durationMs: 1,
            status: 'success',
        });
        // No built-in redaction: the plugin stores exactly what the tool sent/returned.
        expect(savedLogs[0].input).toEqual(input);
        expect(savedLogs[0].output).toEqual(output);
    });

    it("applies the operator redact function when capture is 'full', persisting exactly what it returns", async () => {
        const seen: unknown[] = [];
        const redact = vi.fn((entry: { toolName: string; input: unknown; output: unknown }) => {
            seen.push(entry);
            return { input: { redacted: true }, output: null };
        });
        const { service, savedLogs } = build({ logging: { capture: 'full', redact } });
        await service.logToolCall({
            executionContext: { ctx: { apiType: 'shop', channelId: 1 } } as any,
            tool: toolStub('my_tool'),
            input: { email: 'a@b.com' },
            output: { secret: 1 },
            durationMs: 1,
            status: 'success',
        });
        // The plugin calls the operator function with the tool name + the raw input/output...
        expect(redact).toHaveBeenCalledOnce();
        expect(seen[0]).toEqual({
            toolName: 'my_tool',
            input: { email: 'a@b.com' },
            output: { secret: 1 },
        });
        // ...and persists exactly what it returns (a null body is stored as null).
        expect(savedLogs[0].input).toEqual({ redacted: true });
        expect(savedLogs[0].output).toBeNull();
    });

    it('records the call without bodies and still publishes when the redact function throws', async () => {
        const redact = vi.fn(() => {
            throw new Error('boom');
        });
        const { service, savedLogs, publishedEvents, save } = build({ logging: { capture: 'full', redact } });
        await expect(
            service.logToolCall({
                executionContext: { ctx: { apiType: 'shop', channelId: 1 } } as any,
                tool: toolStub('my_tool'),
                input: { email: 'a@b.com' },
                output: { secret: 1 },
                durationMs: 1,
                status: 'success',
            }),
        ).resolves.toBeUndefined();
        // A broken redact function must not cost the audit row: it's still saved (with its
        // metadata) and published, just fail-closed with no bodies rather than storing the raw
        // (unredacted) ones.
        expect(save).toHaveBeenCalledOnce();
        expect(savedLogs).toHaveLength(1);
        expect(savedLogs[0].input).toBeNull();
        expect(savedLogs[0].output).toBeNull();
        expect(publishedEvents).toHaveLength(1);
        expect(warnSpy).toHaveBeenCalledOnce();
        expect(warnSpy.mock.calls[0][0]).toMatch(/logging\.redact/);
    });

    it('replaces an oversized body with a marker while a small body is stored verbatim', async () => {
        const { service, savedLogs, publishedEvents, save } = build({
            logging: { capture: 'full', maxBodyBytes: 50 },
        });
        const bigInput = { blob: 'x'.repeat(200) };
        const smallOutput = { ok: true };
        await service.logToolCall({
            executionContext: { ctx: { apiType: 'shop', channelId: 1 } } as any,
            tool: toolStub('t'),
            input: bigInput,
            output: smallOutput,
            durationMs: 1,
            status: 'success',
        });
        expect(save).toHaveBeenCalledOnce();
        const stored = savedLogs[0].input as { omitted: string; bytes: number };
        expect(stored.omitted).toMatch(/logging\.maxBodyBytes/);
        expect(stored.bytes).toBeGreaterThan(50);
        expect(savedLogs[0].output).toEqual(smallOutput);
        expect(publishedEvents).toHaveLength(1);
    });

    it('replaces both bodies with markers when both exceed maxBodyBytes', async () => {
        const { service, savedLogs } = build({ logging: { capture: 'full', maxBodyBytes: 50 } });
        await service.logToolCall({
            executionContext: { ctx: { apiType: 'shop', channelId: 1 } } as any,
            tool: toolStub('t'),
            input: { blob: 'x'.repeat(200) },
            output: { blob: 'y'.repeat(200) },
            durationMs: 1,
            status: 'success',
        });
        expect(savedLogs[0].input).toHaveProperty('omitted');
        expect(savedLogs[0].output).toHaveProperty('omitted');
    });

    it('falls back to the 64,000-byte default when maxBodyBytes is not configured', async () => {
        // The service has no fallback of its own: the default comes from resolveMcpPluginOptions
        // in the build() helper, the same resolution init() uses.
        const { service, savedLogs } = build({ logging: { capture: 'full' } });
        const justOverDefault = { blob: 'x'.repeat(64_100) };
        await service.logToolCall({
            executionContext: { ctx: { apiType: 'shop', channelId: 1 } } as any,
            tool: toolStub('t'),
            input: justOverDefault,
            output: { ok: true },
            durationMs: 1,
            status: 'success',
        });
        const stored = savedLogs[0].input as { omitted: string; bytes: number };
        expect(stored.omitted).toMatch(/64000 bytes/);
        expect(stored.bytes).toBeGreaterThan(64_000);
    });

    it('caps a body after redact has run, so an oversized redacted body still yields a marker', async () => {
        const redact = vi.fn(() => ({ input: { blob: 'x'.repeat(200) }, output: null }));
        const { service, savedLogs } = build({ logging: { capture: 'full', redact, maxBodyBytes: 50 } });
        await service.logToolCall({
            executionContext: { ctx: { apiType: 'shop', channelId: 1 } } as any,
            tool: toolStub('t'),
            input: { email: 'a@b.com' },
            output: { secret: 1 },
            durationMs: 1,
            status: 'success',
        });
        expect(redact).toHaveBeenCalledOnce();
        expect(savedLogs[0].input).toHaveProperty('omitted');
        expect(savedLogs[0].output).toBeNull();
    });

    it('publishes a McpToolCallEvent carrying the persisted row, for success and error', async () => {
        const { service, savedLogs, publishedEvents } = build({});
        const ctx = { apiType: 'shop', channelId: 1 } as any;
        await service.logToolCall({
            executionContext: { ctx } as any,
            tool: toolStub('t'),
            input: { email: 'a@b.com' },
            output: {},
            durationMs: 1,
            status: 'success',
        });
        await service.logToolCall({
            executionContext: { ctx } as any,
            tool: toolStub('t'),
            input: {},
            output: { message: 'boom' },
            durationMs: 1,
            status: 'error',
        });
        expect(publishedEvents).toHaveLength(2);
        expect(publishedEvents[0]).toBeInstanceOf(McpToolCallEvent);
        // The event carries the exact persisted row instance, not a copy.
        expect(publishedEvents[0].entry).toBe(savedLogs[0]);
        expect(publishedEvents[1].entry).toBe(savedLogs[1]);
        expect(publishedEvents[0].ctx).toBe(ctx);
        // Default metadata capture: the persisted row (and thus the event) carries no input body.
        expect(publishedEvents[0].entry.input).toBeNull();
    });

    it('never throws and warns when the write fails (no event published)', async () => {
        const { service, publishedEvents } = build({}, { saveThrows: true });
        await expect(
            service.logToolCall({
                executionContext: { ctx: { apiType: 'shop', channelId: 1 } } as any,
                tool: toolStub('t'),
                input: {},
                output: {},
                durationMs: 1,
                status: 'success',
            }),
        ).resolves.toBeUndefined();
        expect(publishedEvents).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledOnce();
        expect(warnSpy.mock.calls[0][0]).toMatch(/Failed to record MCP tool call/);
    });

    it('never throws and warns distinctly when publish rejects after the row is saved', async () => {
        const { service, savedLogs } = build({}, { publishThrows: true });
        await expect(
            service.logToolCall({
                executionContext: { ctx: { apiType: 'shop', channelId: 1 } } as any,
                tool: toolStub('t'),
                input: {},
                output: {},
                durationMs: 1,
                status: 'success',
            }),
        ).resolves.toBeUndefined();
        expect(savedLogs).toHaveLength(1);
        expect(warnSpy).toHaveBeenCalledOnce();
        expect(warnSpy.mock.calls[0][0]).toMatch(/publishing its McpToolCallEvent failed/);
    });

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
