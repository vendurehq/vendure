import assert from 'node:assert/strict';
import test from 'node:test';

import { DASHBOARD_API_PORT_FROM_PAGE, resolveDevelopmentNetwork } from './dev-network-config.mjs';

test('starts the Portless proxy before resolving public URLs', () => {
    const calls = [];

    resolveDevelopmentNetwork({
        mode: 'portless',
        ensurePortlessProxy: () => calls.push('start'),
        getPortlessUrl: name => {
            calls.push(`get:${name}`);
            return `https://${name}.localhost`;
        },
    });

    assert.deepEqual(calls, ['start', 'get:vendure', 'get:dashboard.vendure']);
});

test('does not duplicate a custom Portless proxy port in Dashboard API URLs', () => {
    const network = resolveDevelopmentNetwork({
        mode: 'portless',
        ensurePortlessProxy: () => undefined,
        getPortlessUrl: name => `https://${name}.localhost:1355`,
    });

    assert.equal(network.sharedEnv.VITE_ADMIN_API_HOST, 'https://vendure.localhost');
    assert.equal(network.sharedEnv.VITE_ADMIN_API_PORT, DASHBOARD_API_PORT_FROM_PAGE);
    assert.equal(
        getDashboardApiBaseUrl(network.sharedEnv, 'https://dashboard.vendure.localhost:1355'),
        'https://vendure.localhost:1355',
    );
});

test('uses distinct fixed ports for direct-mode server and Dashboard processes', () => {
    const network = resolveDevelopmentNetwork({
        mode: 'direct',
        ensurePortlessProxy: () => undefined,
        getPortlessUrl: () => {
            throw new Error('Portless URL lookup is not expected in direct mode');
        },
    });

    assert.deepEqual(network.serverEnv, { API_PORT: '3000', PORT: '3000' });
    assert.deepEqual(network.dashboardEnv, { API_PORT: '3000', PORT: '5173' });
    assert.equal(network.apiOrigin, 'http://localhost:3000');
    assert.equal(network.dashboardOrigin, 'http://localhost:5173');
});

function getDashboardApiBaseUrl(env, dashboardOrigin) {
    const dashboardUrl = new URL(dashboardOrigin);
    const port =
        env.VITE_ADMIN_API_PORT === DASHBOARD_API_PORT_FROM_PAGE
            ? dashboardUrl.port
            : env.VITE_ADMIN_API_PORT;
    return `${env.VITE_ADMIN_API_HOST}${port ? `:${port}` : ''}`;
}
