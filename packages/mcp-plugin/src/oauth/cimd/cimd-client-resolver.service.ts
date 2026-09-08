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

/** Caches CIMD documents as client rows so they aren't refetched on every request; invalid documents are never cached. */
@Injectable()
export class McpCimdClientResolverService {
    /** Avoids firing off duplicate fetches when several requests for the same client_id arrive at once. */
    private readonly inFlight = new Map<string, Promise<CimdDocument>>();

    constructor(
        private readonly connection: TransactionalConnection,
        @Inject(MCP_PLUGIN_OPTIONS) private readonly options: ResolvedMcpPluginOptions,
    ) {}

    // Documents on the local machine are a development-only convenience (draft §8.6), so the
    // operator has to ask for them; `McpPlugin` refuses to start with them on in production.
    private get allowLoopback(): boolean {
        return this.options.oauth?.allowLoopbackCimdDocuments === true;
    }

    async resolveClient(ctx: RequestContext, clientId: string): Promise<McpOauthClient> {
        const url = validateCimdClientIdUrl(clientId, { allowLoopback: this.allowLoopback });
        const cached = await this.findClientRow(ctx, clientId);
        if (cached && this.isFresh(cached)) {
            return cached;
        }
        const document = await this.resolveDocument(clientId, url);
        return this.storeDocument(ctx, clientId, document);
    }

    /** Fetches and validates the document, sharing one request with any concurrent caller. */
    private resolveDocument(clientId: string, url: URL): Promise<CimdDocument> {
        const running = this.inFlight.get(clientId);
        if (running) {
            return running;
        }
        const task = fetchCimdDocument(url, {
            timeoutMs: CIMD_FETCH_TIMEOUT_MS,
            maxBytes: CIMD_MAX_DOCUMENT_BYTES,
            allowLoopback: this.allowLoopback,
        })
            .then(body => parseCimdDocument(clientId, body))
            .finally(() => {
                this.inFlight.delete(clientId);
            });
        this.inFlight.set(clientId, task);
        return task;
    }

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
            // If two servers race to create the same client row, use whichever one won rather than
            // failing; other errors must still surface, since the existing row could be stale.
            const winner = await this.findClientRow(ctx, clientId);
            if (winner && this.isFresh(winner)) {
                return winner;
            }
            throw error;
        }
    }

    private async findClientRow(ctx: RequestContext, clientId: string): Promise<McpOauthClient | undefined> {
        const row = await this.connection.getRepository(ctx, McpOauthClient).findOne({ where: { clientId } });
        // SQL equality follows the column collation (MySQL's default ignores case and trailing
        // spaces), so the row is used only when its stored id is exactly the one asked for.
        return row?.clientId === clientId ? row : undefined;
    }

    private isFresh(client: McpOauthClient): boolean {
        return client.cimdDocumentExpiresAt != null && client.cimdDocumentExpiresAt > new Date();
    }
}
