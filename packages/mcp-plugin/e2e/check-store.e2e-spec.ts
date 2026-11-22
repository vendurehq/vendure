import { mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { McpPlugin } from '../src/plugin';
import { McpPluginOptions } from '../src/types';

import { callTool, postMcp } from './utils/mcp-http-client';
import { runAuthorizationCodeFlow } from './utils/oauth-test-client';
import { testServerInit } from './utils/test-server';

const TOKEN_SECRET = 'check-store-secret-00000000000000000000000';
const ISSUER = `http://localhost:${testConfig().apiOptions.port}`;

describe('check_store MCP tool', () => {
    const options: McpPluginOptions = {
        oauth: { tokenSecret: TOKEN_SECRET },
        rateLimits: { oauthIp: false },
    };
    const config = mergeConfig(testConfig(), { plugins: [McpPlugin.init(options)] });
    const { server, adminClient } = createTestEnvironment(config);
    const baseUrl = () => `http://localhost:${config.apiOptions.port}`;
    let token: string;

    beforeAll(async () => {
        McpPlugin.init(options);
        await server.init(testServerInit);
        await adminClient.asSuperAdmin();
        const flow = await runAuthorizationCodeFlow({
            baseUrl: baseUrl(),
            issuer: ISSUER,
            superAdminToken: adminClient.getAuthToken(),
        });
        token = flow.access_token;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('is a read-only tool on the admin toolset', async () => {
        const response = await postMcp(
            baseUrl(),
            'admin',
            { jsonrpc: '2.0', id: 1, method: 'tools/list' },
            { token },
        );
        const tool = response.body.result.tools.find((t: { name: string }) => t.name === 'check_store');
        expect(tool.annotations).toMatchObject({ readOnlyHint: true });
    });

    it('returns the store readiness report with coded findings and tool fixes', async () => {
        const response = await postMcp(baseUrl(), 'admin', callTool('check_store', {}), { token });
        const result = response.body.result;
        expect(result.isError).toBeUndefined();
        const report = result.structuredContent as {
            ready: boolean;
            findings: Array<{ code: string; fixes: Array<{ path: string[] }> }>;
        };
        // The fixture store has no payment method.
        expect(report.ready).toBe(false);
        const finding = report.findings.find(f => f.code === 'store.channel.no-payment-method');
        expect(finding).toBeDefined();
        for (const f of report.findings) {
            expect(f.code).toMatch(/^store(\.[a-z0-9-]+)+$/);
            for (const fix of f.fixes) {
                expect(fix.path[0]).toMatch(/^admin_[a-z_]+$/);
            }
        }
    });
});
