import { BadRequestException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { McpOauthClient } from '../../entities/mcp-oauth-client.entity';
import { resolveMcpPluginOptions } from '../../resolve-options';
import { McpPluginOptions } from '../../types';

import { McpCimdClientResolverService } from './cimd-client-resolver.service';
import * as cimdFetch from './cimd-fetch';

vi.mock('./cimd-fetch', async importOriginal => {
    const original = await importOriginal<typeof import('./cimd-fetch')>();
    return { ...original, fetchCimdDocument: vi.fn() };
});

const CLIENT_ID = 'https://client.example.com/oauth-client-metadata.json';

function documentBody(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
        client_id: CLIENT_ID,
        client_name: 'Example MCP Client',
        redirect_uris: ['https://client.example.com/callback'],
        ...overrides,
    });
}

const fetchMock = vi.mocked(cimdFetch.fetchCimdDocument);

// The SWC unit build uses define semantics for class fields, so constructor-passed
// scalars on entities are wiped back to undefined — assign fields explicitly instead.
function makeRow(clientId: string, expiresAt: Date | null): McpOauthClient {
    const row = new McpOauthClient();
    row.clientId = clientId;
    row.cimdDocumentExpiresAt = expiresAt;
    return row;
}

interface ResolverHarnessOptions {
    /** Rows already on file. */
    rows?: McpOauthClient[];
    /** Makes every write fail, standing in for a lost connection or an over-long value. */
    failWrites?: boolean;
    /** Turns on the development-only exception for documents on the local machine. */
    allowLoopback?: boolean;
}

function createResolver(harness: ResolverHarnessOptions = {}) {
    const rows = [...(harness.rows ?? [])];
    const repository = {
        // Reads return a copy, as a real database read does: a row the service mutated in memory
        // but failed to save must still read back as the stored version.
        findOne: vi.fn(({ where }: any) => {
            const row = rows.find(candidate => candidate.clientId === where.clientId);
            return Promise.resolve(row ? Object.assign(new McpOauthClient(), row) : null);
        }),
        save: vi.fn((entity: McpOauthClient) => {
            if (harness.failWrites) {
                return Promise.reject(new Error('write failed'));
            }
            const index = rows.findIndex(candidate => candidate.clientId === entity.clientId);
            if (index === -1) {
                rows.push(entity);
            } else {
                rows[index] = entity;
            }
            return Promise.resolve(entity);
        }),
    };
    const connection = { getRepository: () => repository } as any;
    const options: McpPluginOptions = {
        oauth: { tokenSecret: 's', allowLoopbackCimdDocuments: harness.allowLoopback === true },
    };
    return {
        resolver: new McpCimdClientResolverService(connection, resolveMcpPluginOptions(options)),
        repository,
        rows,
    };
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T12:00:00Z'));
    fetchMock.mockReset();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('McpCimdClientResolverService', () => {
    it('returns a fresh cached row without fetching', async () => {
        const cached = makeRow(CLIENT_ID, new Date('2026-08-03T13:00:00Z'));
        cached.clientName = 'Cached Client';
        const { resolver } = createResolver({ rows: [cached] });

        const result = await resolver.resolveClient({} as any, CLIENT_ID);
        expect(result.clientName).toBe('Cached Client');
        expect(result.cimdDocumentExpiresAt).toEqual(new Date('2026-08-03T13:00:00Z'));
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fetches, validates and stores the document when the row is stale', async () => {
        const stale = makeRow(CLIENT_ID, new Date('2026-08-03T11:00:00Z'));
        const { resolver, repository } = createResolver({ rows: [stale] });
        fetchMock.mockResolvedValue(documentBody());

        const result = await resolver.resolveClient({} as any, CLIENT_ID);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(repository.save).toHaveBeenCalledTimes(1);
        expect(result.clientName).toBe('Example MCP Client');
        expect(result.cimdDocumentExpiresAt).toEqual(new Date('2026-08-03T13:00:00Z'));
    });

    it('creates the row on first resolution', async () => {
        const { resolver, rows } = createResolver();
        fetchMock.mockResolvedValue(documentBody());

        const result = await resolver.resolveClient({} as any, CLIENT_ID);
        expect(rows).toContain(result);
        // The fixed one-hour document lifetime.
        expect(result.cimdDocumentExpiresAt).toEqual(new Date('2026-08-03T13:00:00Z'));
    });

    it('does not store anything when the fetch fails', async () => {
        const { resolver, repository } = createResolver();
        fetchMock.mockRejectedValue(
            new BadRequestException('client_id metadata document request failed with HTTP 404'),
        );

        await expect(resolver.resolveClient({} as any, CLIENT_ID)).rejects.toThrow('HTTP 404');
        expect(repository.save).not.toHaveBeenCalled();
    });

    it('does not store anything when the document is invalid', async () => {
        const { resolver, repository } = createResolver();
        fetchMock.mockResolvedValue(documentBody({ client_id: 'https://other.example.com/x.json' }));

        await expect(resolver.resolveClient({} as any, CLIENT_ID)).rejects.toThrow('must exactly match');
        expect(repository.save).not.toHaveBeenCalled();
    });

    // A write failure other than losing an insert race leaves an older document on file. Serving
    // it would authorize a redirect destination the client may have just removed.
    it('fails rather than serving the previous document when the write fails', async () => {
        const stale = makeRow(CLIENT_ID, new Date('2026-08-03T11:00:00Z'));
        stale.redirectUris = ['https://client.example.com/old-callback'];
        const { resolver } = createResolver({ rows: [stale], failWrites: true });
        fetchMock.mockResolvedValue(documentBody());

        await expect(resolver.resolveClient({} as any, CLIENT_ID)).rejects.toThrow('write failed');
    });

    // Losing the race to insert the first row is the one write failure that is safe to absorb.
    it('serves the row another server inserted first when the write loses that race', async () => {
        const { resolver, rows } = createResolver({ failWrites: true });
        fetchMock.mockResolvedValue(documentBody());
        // The winning insert lands while this request is fetching.
        rows.push(makeRow(CLIENT_ID, new Date('2026-08-03T12:30:00Z')));

        const result = await resolver.resolveClient({} as any, CLIENT_ID);
        expect(result.cimdDocumentExpiresAt).toEqual(new Date('2026-08-03T12:30:00Z'));
    });

    // MySQL's default collation ignores case, so a lookup can return another client's row.
    it('ignores a stored row whose client_id differs in case', async () => {
        const otherCasing = makeRow(CLIENT_ID.replace('client', 'CLIENT'), new Date('2026-08-03T13:00:00Z'));
        const { resolver, repository } = createResolver({ rows: [otherCasing] });
        // Stand in for a case-insensitive comparison: the query matches the case-variant row.
        repository.findOne.mockResolvedValue(otherCasing);
        fetchMock.mockResolvedValue(documentBody());

        const result = await resolver.resolveClient({} as any, CLIENT_ID);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(result.clientId).toBe(CLIENT_ID);
        expect(otherCasing.clientName).toBeUndefined();
    });

    it('rejects an invalid client_id URL before any fetch', async () => {
        const { resolver } = createResolver();
        await expect(resolver.resolveClient({} as any, 'https://client.example.com/')).rejects.toThrow(
            BadRequestException,
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });

    // The development-only exception for documents on the local machine (draft §8.6) is off
    // unless the operator turns it on.
    it('refuses a loopback client_id URL unless the option is set', async () => {
        const loopbackClientId = 'http://127.0.0.1:9000/client-metadata.json';
        const { resolver } = createResolver();
        await expect(resolver.resolveClient({} as any, loopbackClientId)).rejects.toThrow(
            BadRequestException,
        );
        expect(fetchMock).not.toHaveBeenCalled();

        const { resolver: permissive } = createResolver({ allowLoopback: true });
        fetchMock.mockResolvedValue(
            JSON.stringify({
                client_id: loopbackClientId,
                client_name: 'Local Client',
                redirect_uris: ['https://client.example.com/callback'],
            }),
        );
        const result = await permissive.resolveClient({} as any, loopbackClientId);
        expect(result.clientName).toBe('Local Client');
    });

    it('merges concurrent resolutions of the same client_id into one fetch', async () => {
        const { resolver } = createResolver();
        let release!: (value: string) => void;
        fetchMock.mockReturnValue(new Promise(resolve => (release = resolve)));

        const first = resolver.resolveClient({} as any, CLIENT_ID);
        const second = resolver.resolveClient({} as any, CLIENT_ID);
        release(documentBody());
        const [a, b] = await Promise.all([first, second]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(a.clientName).toBe('Example MCP Client');
        expect(b.clientName).toBe('Example MCP Client');
    });
});
