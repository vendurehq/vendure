import { fail } from '@vendure/common/lib/command';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runCommandInHarness } from '../../command-host/__tests__/command-harness.js';
import { localAdminApiErrors } from '../../shared/local-admin-api.js';
import { stripAnsi } from '../../shared/strip-ansi.js';

import { storeCheckDefinition } from './store-check.command.js';
import { render } from './store-check.render.js';
import { output, StoreCheckOutput } from './store-check.schema.js';

const graphql = vi.hoisted(() => vi.fn());
const devServerState = vi.hoisted(() => vi.fn());

vi.mock('../../shared/local-admin-api.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../../shared/local-admin-api.js')>()),
    localAdminGraphql: graphql,
}));

vi.mock('../devserver/devserver.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../devserver/devserver.js')>()),
    resolveDevServerStateProject: () => '/project',
}));

vi.mock('../dev/state-file.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../dev/state-file.js')>()),
    readDevServerState: devServerState,
}));

const taxFinding = {
    code: 'store.tax.inclusive-rate-unknown',
    severity: 'ERROR' as const,
    message: 'Channel "default" has prices that include tax, but ...',
    channelId: '1',
    zoneId: '2',
    countryCode: null,
    taxCategoryId: '3',
    fixes: [
        {
            path: ['admin_create_tax_rate'],
            input: { input: { name: 'Standard Europe', taxCategoryId: 3, target: { zoneId: 2 } } },
            description: 'Add a rate for the zone "Europe".',
        },
    ],
    dashboardUrl: '/tax-rates',
};

const passwordWarning = {
    code: 'store.auth.default-superadmin-password',
    severity: 'WARNING' as const,
    message: 'The superadmin still has the default password.',
    channelId: null,
    zoneId: null,
    countryCode: null,
    taxCategoryId: null,
    fixes: [],
    dashboardUrl: null,
};

function report(ready: boolean, findings: unknown[]) {
    return { data: { storeReadiness: { ready, findings } } };
}

describe('vendure store check', () => {
    beforeEach(() => {
        graphql.mockReset();
        devServerState.mockReset();
        devServerState.mockReturnValue({ urls: { dashboard: 'http://localhost:3000/dashboard' } });
    });

    it('runs the storeReadiness query on the local Admin API', async () => {
        graphql.mockResolvedValue(report(true, []));
        await runCommandInHarness(storeCheckDefinition, {});
        expect(graphql).toHaveBeenCalledWith(
            '/project',
            expect.objectContaining({ query: expect.stringContaining('storeReadiness') }),
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
    });

    it('is ok for a ready store, and the output matches the output schema', async () => {
        graphql.mockResolvedValue(report(true, [passwordWarning]));
        const { envelope, exitCode } = await runCommandInHarness(storeCheckDefinition, {});
        expect(envelope.status).toBe('ok');
        expect(exitCode).toBe(0);
        expect(output.parse(envelope.output)).toEqual({
            ready: true,
            findings: [passwordWarning],
            dashboard: 'http://localhost:3000/dashboard',
        });
    });

    it('fails with the report as output and a non-zero exit when the store is not ready', async () => {
        graphql.mockResolvedValue(report(false, [taxFinding, passwordWarning]));
        const { envelope, exitCode } = await runCommandInHarness(storeCheckDefinition, {});
        expect(envelope.status).toBe('failed');
        expect(exitCode).not.toBe(0);
        const parsed = output.parse(envelope.output);
        expect(parsed.ready).toBe(false);
        expect(parsed.findings.map(f => f.code)).toEqual([taxFinding.code, passwordWarning.code]);
    });

    it('passes on the error of the local Admin API helper', async () => {
        graphql.mockResolvedValue(fail(localAdminApiErrors.notRunning, {}));
        const { envelope, exitCode } = await runCommandInHarness(storeCheckDefinition, {});
        expect(envelope.status).toBe('error');
        expect(envelope.error?.code).toBe('devserver.not-running');
        expect(exitCode).not.toBe(0);
    });

    it('reports a server without the storeReadiness query', async () => {
        graphql.mockResolvedValue({
            errors: [{ message: 'Cannot query field "storeReadiness" on type "Query".' }],
        });
        const { envelope } = await runCommandInHarness(storeCheckDefinition, {});
        expect(envelope.error?.code).toBe('store.check.not-supported');
    });

    it('reports a failed query with its request ID, and a fix that reads its logs', async () => {
        graphql.mockResolvedValue({
            errors: [{ message: 'You are not currently authorized', extensions: { requestId: 'req-1' } }],
        });
        const { envelope } = await runCommandInHarness(storeCheckDefinition, {});
        expect(envelope.error?.code).toBe('store.check.query-failed');
        expect(envelope.error?.message).toContain('request ID req-1');
        expect(envelope.error?.fixes).toEqual([
            expect.objectContaining({ path: ['devserver', 'logs'], input: { request: 'req-1' } }),
        ]);
    });

    it('is not an MCP tool', () => {
        expect(storeCheckDefinition.expose).toEqual({ mcp: false });
        expect(storeCheckDefinition.behavior).toBe('readonly');
    });
});

describe('render()', () => {
    it('prints each finding with its tool call fixes and its Dashboard link', () => {
        const out: StoreCheckOutput = {
            ready: false,
            findings: [taxFinding, passwordWarning],
            dashboard: 'http://localhost:3000/dashboard/',
        };
        const text = stripAnsi(render(out));
        expect(text).toContain('error store.tax.inclusive-rate-unknown');
        expect(text).toContain(
            'admin_create_tax_rate {"input":{"name":"Standard Europe","taxCategoryId":3,"target":{"zoneId":2}}}',
        );
        expect(text).toContain('dashboard http://localhost:3000/dashboard/tax-rates');
        expect(text).toContain('warning store.auth.default-superadmin-password');
        expect(text).toContain('The store cannot take orders: 1 error, 1 warning.');
    });

    it('prints the Dashboard path alone when the dev server reported no Dashboard', () => {
        const text = stripAnsi(render({ ready: false, findings: [taxFinding] }));
        expect(text).toContain('dashboard /tax-rates');
    });

    it('says when the store can take orders', () => {
        expect(stripAnsi(render({ ready: true, findings: [] }))).toBe('The store can take orders.');
    });
});
