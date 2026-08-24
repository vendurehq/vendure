import { mergeConfig, TransactionalConnection } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { McpOauthClient } from '../src/entities/mcp-oauth-client.entity';
import { McpPlugin } from '../src/plugin';

import { CimdTestServer, startCimdTestServer } from './utils/cimd-test-server';
import { PLACEHOLDER_CODE_CHALLENGE, runAuthorizationCodeFlow } from './utils/oauth-test-client';
import { testServerInit } from './utils/test-server';

// CIMD (Client ID Metadata Documents, draft-ietf-oauth-client-id-metadata-document): the
// client_id is a URL; the server fetches the client's metadata from it instead of
// requiring registration.
describe('McpPlugin OAuth CIMD client registration', () => {
    const config = mergeConfig(testConfig(), {
        plugins: [
            McpPlugin.init({
                oauth: {
                    tokenSecret: 'test-secret',
                    // The metadata documents in this suite are served from a loopback address, so
                    // the development-only exception has to be asked for. It is off by default and
                    // the plugin refuses to start with it on in production.
                    allowLoopbackCimdDocuments: true,
                },
            }),
        ],
    });
    const { server, adminClient } = createTestEnvironment(config);
    // The issuer the plugin derives when none is configured: localhost on the configured API port.
    const issuer = `http://localhost:${config.apiOptions.port}`;
    let baseUrl: string;
    let documentServer: CimdTestServer;
    let superAdminToken: string;

    const REDIRECT_URI = 'https://example.com/cb';

    function documentFor(clientId: string, overrides: Record<string, unknown> = {}) {
        return {
            client_id: clientId,
            client_name: 'CIMD Test Client',
            redirect_uris: [REDIRECT_URI],
            ...overrides,
        };
    }

    /** Runs an authorize request outside the flow helper and reports only its HTTP status. */
    async function authorizeStatus(clientId: string): Promise<number> {
        const response = await fetch(authorizeUrl(clientId), { redirect: 'manual' });
        return response.status;
    }

    function authorizeUrl(clientId: string): URL {
        const url = new URL(`${baseUrl}/mcp/oauth/authorize`);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('client_id', clientId);
        url.searchParams.set('redirect_uri', REDIRECT_URI);
        url.searchParams.set('code_challenge', PLACEHOLDER_CODE_CHALLENGE);
        url.searchParams.set('code_challenge_method', 'S256');
        url.searchParams.set('resource', `${issuer}/mcp/admin`);
        return url;
    }

    beforeAll(async () => {
        await server.init(testServerInit);
        baseUrl = `http://localhost:${config.apiOptions.port}`;
        await adminClient.asSuperAdmin();
        superAdminToken = adminClient.getAuthToken();
        documentServer = await startCimdTestServer();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await documentServer.close();
        await server.destroy();
    });

    it('completes the full authorization-code flow with a URL client_id', async () => {
        const clientId = `${documentServer.baseUrl}/happy/client-metadata.json`;
        documentServer.setDocument('/happy/client-metadata.json', documentFor(clientId));

        const result = await runAuthorizationCodeFlow({
            baseUrl,
            issuer,
            superAdminToken,
            clientId,
            redirectUri: REDIRECT_URI,
        });
        expect(result.access_token).toBeTruthy();
        expect(result.refresh_token).toBeTruthy();

        // The refresh grant also works with a URL client_id (string comparison at /token).
        const refreshResponse = await fetch(`${baseUrl}/mcp/oauth/token`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                grant_type: 'refresh_token',
                refresh_token: result.refresh_token,
                client_id: clientId,
                resource: result.resource,
            }),
        });
        expect(refreshResponse.status).toBe(200);
    });

    it('reports the client as cimd-sourced on the consent info endpoint', async () => {
        const clientId = `${documentServer.baseUrl}/info/client-metadata.json`;
        documentServer.setDocument('/info/client-metadata.json', documentFor(clientId));

        const authorizeResponse = await fetch(authorizeUrl(clientId), { redirect: 'manual' });
        expect(authorizeResponse.status).toBe(302);
        const location = authorizeResponse.headers.get('location');
        const requestToken = new URL(location as string).searchParams.get('request_token');

        const infoResponse = await fetch(
            `${baseUrl}/mcp/oauth/authorization-request?request_token=${encodeURIComponent(
                requestToken as string,
            )}`,
        );
        const info = await infoResponse.json();
        expect(info.client_id).toBe(clientId);
        expect(info.client_id_source).toBe('cimd');
        expect(info.client_name).toBe('CIMD Test Client');
    });

    it('serves the cached document within its lifetime instead of refetching', async () => {
        const clientId = `${documentServer.baseUrl}/cached/client-metadata.json`;
        documentServer.setDocument('/cached/client-metadata.json', documentFor(clientId));

        expect(await authorizeStatus(clientId)).toBe(302);
        expect(await authorizeStatus(clientId)).toBe(302);
        expect(documentServer.requestCount('/cached/client-metadata.json')).toBe(1);
    });

    it('rejects the request when the document client_id does not match the URL', async () => {
        const clientId = `${documentServer.baseUrl}/mismatch/client-metadata.json`;
        documentServer.setDocument(
            '/mismatch/client-metadata.json',
            documentFor('https://somewhere-else.example.com/client-metadata.json'),
        );
        expect(await authorizeStatus(clientId)).toBe(400);
    });

    it('rejects a redirect_uri that is not listed in the document', async () => {
        const clientId = `${documentServer.baseUrl}/other-redirect/client-metadata.json`;
        documentServer.setDocument(
            '/other-redirect/client-metadata.json',
            documentFor(clientId, { redirect_uris: ['https://legit.example.com/cb'] }),
        );
        expect(await authorizeStatus(clientId)).toBe(400);
    });

    it('fails the request on a fetch error and does not cache the failure', async () => {
        const clientId = `${documentServer.baseUrl}/flaky/client-metadata.json`;
        documentServer.setError('/flaky/client-metadata.json', 500);
        expect(await authorizeStatus(clientId)).toBe(400);

        // The failure was not cached (draft §5.2): once the document is reachable, the
        // very next authorization request succeeds.
        documentServer.setDocument('/flaky/client-metadata.json', documentFor(clientId));
        expect(await authorizeStatus(clientId)).toBe(302);
        expect(documentServer.requestCount('/flaky/client-metadata.json')).toBe(2);
    });

    it('persists the resolved client as a row carrying a document expiry', async () => {
        const clientId = `${documentServer.baseUrl}/row/client-metadata.json`;
        documentServer.setDocument('/row/client-metadata.json', documentFor(clientId));
        expect(await authorizeStatus(clientId)).toBe(302);

        const row = await server.app
            .get(TransactionalConnection)
            .rawConnection.getRepository(McpOauthClient)
            .findOne({ where: { clientId } });
        expect(row).toBeTruthy();
        expect(row?.cimdDocumentExpiresAt).toBeTruthy();
        expect(row?.clientName).toBe('CIMD Test Client');
    });

    // A backslash is a path separator to the URL parser, so this client_id resolves to
    // /canon/b.json. Without the canonical-form check the server would fetch that document —
    // which is served here, and whose client_id matches the raw string — while recording and
    // showing the administrator the unresolved path.
    it('rejects a client_id URL that is not in canonical form', async () => {
        const clientId = `${documentServer.baseUrl}/canon/a\\..\\b.json`;
        documentServer.setDocument('/canon/b.json', documentFor(clientId));
        expect(await authorizeStatus(clientId)).toBe(400);
        expect(documentServer.requestCount('/canon/b.json')).toBe(0);
    });

    // A client that registered itself still works, and its row carries no document expiry — which
    // is what marks it as not resolved from a metadata document.
    it('keeps registered (DCR) clients working and free of a document expiry', async () => {
        const result = await runAuthorizationCodeFlow({
            baseUrl,
            issuer,
            superAdminToken,
        });
        expect(result.access_token).toBeTruthy();

        const row = await server.app
            .get(TransactionalConnection)
            .rawConnection.getRepository(McpOauthClient)
            .findOne({ where: { clientId: result.client_id } });
        expect(row).toBeTruthy();
        expect(row?.cimdDocumentExpiresAt).toBeNull();
    });
});
