import { ModuleRef } from '@nestjs/core';
import {
    Injector,
    mergeConfig,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { McpToolCallLog } from '../src/entities/mcp-tool-call-log.entity';
import { McpToolCallLogService } from '../src/logging/mcp-tool-call-log.service';
import { McpPlugin } from '../src/plugin';
import { mcpToolCallLogRetentionTask } from '../src/tasks/mcp-tool-call-log-retention.task';
import { McpPluginOptions } from '../src/types';

import { backdateLogCreatedAt } from './utils/log-fixtures';
import { initTestServer } from './utils/test-server';

const DAY_MS = 86_400_000;

describe('MCP tool-call log retention', () => {
    // 30-day retention window; rows older than that are pruned.
    const options: McpPluginOptions = { logging: { ttlDays: 30 } };
    const config = mergeConfig(testConfig(), { plugins: [McpPlugin.init(options)] });
    const { server } = createTestEnvironment(config);

    let connection: TransactionalConnection;
    let adminCtx: RequestContext;
    let toolCallLog: McpToolCallLogService;

    beforeAll(async () => {
        McpPlugin.init(options);
        await initTestServer(server);
        connection = server.app.get(TransactionalConnection);
        toolCallLog = server.app.get(McpToolCallLogService);
        adminCtx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    /** Inserts a log row and forces its `createdAt` to `ageInDays` in the past. */
    async function seedLog(toolName: string, ageInDays: number): Promise<void> {
        const repo = connection.getRepository(adminCtx, McpToolCallLog);
        const row = await repo.save(repo.create({ toolName, actorType: 'admin', status: 'success' }));
        const createdAt = new Date(Date.now() - ageInDays * DAY_MS);
        await backdateLogCreatedAt(connection, adminCtx, row.id, createdAt);
    }

    async function toolNames(): Promise<string[]> {
        const rows = await connection.getRepository(adminCtx, McpToolCallLog).find();
        return rows.map(r => r.toolName);
    }

    it('deleteExpiredToolCallLogs deletes only rows older than ttlDays and returns the count', async () => {
        await seedLog('retain-recent', 1); // within the 30-day window
        await seedLog('expire-old-a', 40); // expired
        await seedLog('expire-old-b', 60); // expired

        const deleted = await toolCallLog.deleteExpiredToolCallLogs(adminCtx);
        expect(deleted).toBe(2);

        const names = await toolNames();
        expect(names).toContain('retain-recent');
        expect(names).not.toContain('expire-old-a');
        expect(names).not.toContain('expire-old-b');
    });

    it('prunes expired rows when driven through the scheduled task', async () => {
        await seedLog('task-expired', 90);

        const injector = new Injector(server.app.get(ModuleRef));
        const result = (await mcpToolCallLogRetentionTask.execute(injector)) as { deletedCount: number };
        expect(result.deletedCount).toBe(1);

        const names = await toolNames();
        expect(names).not.toContain('task-expired');
        expect(names).toContain('retain-recent'); // untouched — still within the window
    });
});
