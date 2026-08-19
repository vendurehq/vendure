import { Inject, Injectable } from '@nestjs/common';
import { RequestContext, TransactionalConnection } from '@vendure/core';

import {
    CIMD_CACHE_TTL_SECONDS,
    CIMD_FETCH_TIMEOUT_MS,
    CIMD_MAX_DOCUMENT_BYTES,
    MCP_PLUGIN_OPTIONS,
} from '../../constants';
import { McpOauthClient } from '../../entities/mcp-oauth-client.entity';
import { ResolvedMcpPluginOptions } from '../../internal-types';
import { addSeconds } from '../oauth-utils';

import { CimdDocument, parseCimdDocument } from './cimd-document';
import { fetchCimdDocument } from './cimd-fetch';
import { validateCimdClientIdUrl } from './cimd-url';

/**
 * Resolves a URL-shaped client_id into an {@link McpOauthClient} row by fetching and
 * validating its client metadata document (CIMD). The row doubles as the document cache:
 * it is reused untouched until `cimdDocumentExpiresAt` passes and refreshed after.
 * Failed fetches and invalid documents are never cached (draft §5.2) — they store nothing,
 * and a stale row left behind is ignored by the freshness check, so the authorization
 * request simply aborts (§5.1).
 */
@Injectable()
export class McpCimdClientResolverService {
    /**
     * Merges concurrent fetches of the same client_id into one outbound request. It holds the
     * fetched document rather than the stored row, so each caller writes its own row using its
     * own request context.
     */
    private inFlight = new Map<string, Promise<CimdDocument>>();

    constructor(
        private connection: TransactionalConnection,
        @Inject(MCP_PLUGIN_OPTIONS) private options: ResolvedMcpPluginOptions,
    ) {}

    async resolveClient(ctx: RequestContext, clientId: string): Promise<McpOauthClient> {
        // Documents on the local machine are a development-only convenience (draft §8.6), so the
        // operator has to ask for them; `McpPlugin` refuses to start with them on in production.
        const allowLoopback = this.options.oauth?.allowLoopbackCimdDocuments === true;
        const url = validateCimdClientIdUrl(clientId, { allowLoopback });
        const cached = await this.findClientRow(ctx, clientId);
        if (cached && this.isFresh(cached)) {
            return cached;
        }
        const document = await this.resolveDocument(clientId, url, allowLoopback);
        return this.storeDocument(ctx, clientId, document);
    }

    /** Fetches and validates the document, sharing one request with any concurrent caller. */
    private resolveDocument(clientId: string, url: URL, allowLoopback: boolean): Promise<CimdDocument> {
        const running = this.inFlight.get(clientId);
        if (running) {
            return running;
        }
        const task = this.fetchAndValidate(clientId, url, allowLoopback).finally(() => {
            this.inFlight.delete(clientId);
        });
        this.inFlight.set(clientId, task);
        return task;
    }

    private async fetchAndValidate(
        clientId: string,
        url: URL,
        allowLoopback: boolean,
    ): Promise<CimdDocument> {
        const body = await fetchCimdDocument(url, {
            timeoutMs: CIMD_FETCH_TIMEOUT_MS,
            maxBytes: CIMD_MAX_DOCUMENT_BYTES,
            allowLoopback,
        });
        return parseCimdDocument(clientId, body);
    }

    /** Writes the validated document to its client row, creating the row the first time. */
    private async storeDocument(
        ctx: RequestContext,
        clientId: string,
        document: CimdDocument,
    ): Promise<McpOauthClient> {
        const repository = this.connection.getRepository(ctx, McpOauthClient);
        let client = await this.findClientRow(ctx, clientId);
        if (!client) {
            client = new McpOauthClient();
            client.clientId = clientId;
            client.lastUsedAt = null;
        }
        client.clientName = document.clientName;
        client.clientUri = document.clientUri;
        client.logoUri = document.logoUri;
        client.redirectUris = document.redirectUris;
        client.grantTypes = document.grantTypes;
        client.tokenEndpointAuthMethod = document.tokenEndpointAuthMethod;
        client.cimdDocumentExpiresAt = addSeconds(new Date(), CIMD_CACHE_TTL_SECONDS);
        try {
            return await repository.save(client);
        } catch (error) {
            // Two servers can race to insert the first row for one client_id, and the unique
            // index lets only one of them win; serve the winner's copy. Any other write failure
            // must surface, because the row still on file describes an older document — carrying
            // on with it would authorize a redirect destination the client has since dropped.
            const winner = await this.findClientRow(ctx, clientId);
            if (winner && this.isFresh(winner)) {
                return winner;
            }
            throw error;
        }
    }

    /**
     * Loads the row for exactly this client_id. The database comparison can be case-insensitive —
     * that is MySQL's default — while a CIMD client_id is identified by its exact characters, so a
     * row that merely differs in case belongs to a different client and must not be read or
     * overwritten.
     */
    private async findClientRow(ctx: RequestContext, clientId: string): Promise<McpOauthClient | undefined> {
        const row = await this.connection.getRepository(ctx, McpOauthClient).findOne({ where: { clientId } });
        return row?.clientId === clientId ? row : undefined;
    }

    /**
     * Only a row this service wrote has an expiry, so the expiry alone identifies a usable cached
     * document; a registered (DCR) row never reaches here, because the OAuth service routes URL
     * client_ids to this service and everything else to its own lookup.
     */
    private isFresh(client: McpOauthClient): boolean {
        return client.cimdDocumentExpiresAt != null && client.cimdDocumentExpiresAt > new Date();
    }
}
