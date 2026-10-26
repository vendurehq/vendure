import { Inject, Injectable } from '@nestjs/common';
import { ConfigService, ID, RequestContext, Session, TransactionalConnection } from '@vendure/core';
import { ObjectLiteral, ObjectType } from 'typeorm';

import {
    MCP_PLUGIN_OPTIONS,
    MCP_UNUSED_OAUTH_CLIENT_RETENTION_MS,
    MS_PER_DAY,
    RETENTION_DELETE_BATCH_SIZE,
} from '../constants';
import { deleteInBatches } from '../delete-in-batches';
import { McpAuthorizationCode } from '../entities/mcp-authorization-code.entity';
import { McpAuthorizationRequest } from '../entities/mcp-authorization-request.entity';
import { McpOauthClient } from '../entities/mcp-oauth-client.entity';
import { McpOauthGrant } from '../entities/mcp-oauth-grant.entity';
import { ResolvedMcpPluginOptions } from '../internal-types';

import { deleteCachedVendureSession } from './oauth-utils';

export interface McpOauthRetentionResult {
    deletedSessions: number;
    deletedRequests: number;
    deletedCodes: number;
    deletedGrants: number;
    deletedClients: number;
}

@Injectable()
export class McpOauthRetentionService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly configService: ConfigService,
        @Inject(MCP_PLUGIN_OPTIONS) private readonly options: ResolvedMcpPluginOptions,
    ) {}

    async deleteExpiredOauthRecords(ctx: RequestContext): Promise<McpOauthRetentionResult> {
        const deletedSessions = await this.deleteSessionsOfDeadGrants(ctx);
        const deletedRequests = await this.deleteExpiredShortLivedRecords(ctx, McpAuthorizationRequest);
        const deletedCodes = await this.deleteExpiredShortLivedRecords(ctx, McpAuthorizationCode);
        const deletedGrants = await this.deleteDeadGrants(ctx);
        const deletedClients = await this.deleteUnusedClients(ctx);
        return { deletedSessions, deletedRequests, deletedCodes, deletedGrants, deletedClients };
    }

    /** Prevents expired or revoked grants from leaving a live GraphQL session behind. */
    private deleteSessionsOfDeadGrants(ctx: RequestContext): Promise<number> {
        return deleteInBatches(
            this.connection,
            ctx,
            Session,
            () =>
                this.connection
                    .getRepository(ctx, McpOauthGrant)
                    .createQueryBuilder('grant')
                    .select('session.id', 'id')
                    .addSelect('session.token', 'token')
                    .innerJoin(Session, 'session', 'session.id = grant.vendureSessionId')
                    .where('grant.expiresAt <= :now', { now: new Date() })
                    .orWhere('grant.revokedAt IS NOT NULL')
                    .limit(RETENTION_DELETE_BATCH_SIZE)
                    .getRawMany<{ id: ID; token: string }>(),
            async sessions => {
                for (const session of sessions) {
                    await deleteCachedVendureSession(this.configService, session.token);
                }
            },
        );
    }

    /** Only ever catches abandoned flows, since a used request or code is deleted immediately when it's consumed. */
    private deleteExpiredShortLivedRecords<T extends ObjectLiteral>(
        ctx: RequestContext,
        entity: ObjectType<T>,
    ): Promise<number> {
        return deleteInBatches(this.connection, ctx, entity, () =>
            this.connection
                .getRepository(ctx, entity)
                .createQueryBuilder('record')
                .select('record.id', 'id')
                .where('record.expiresAt <= :now', { now: new Date() })
                .limit(RETENTION_DELETE_BATCH_SIZE)
                .getRawMany<{ id: ID }>(),
        );
    }

    /** Kept longer than other OAuth records for audit value; the default retention matches the tool-call log window so a retained log can still resolve its grant. */
    private deleteDeadGrants(ctx: RequestContext): Promise<number> {
        const oauth = this.options.oauth;
        if (!oauth || oauth.grantRetentionDays === 0) {
            return Promise.resolve(0);
        }
        const cutoff = new Date(Date.now() - oauth.grantRetentionDays * MS_PER_DAY);
        return deleteInBatches(this.connection, ctx, McpOauthGrant, () =>
            this.connection
                .getRepository(ctx, McpOauthGrant)
                .createQueryBuilder('grant')
                .select('grant.id', 'id')
                .where('grant.expiresAt < :cutoff', { cutoff })
                .orWhere('grant.revokedAt < :cutoff', { cutoff })
                .limit(RETENTION_DELETE_BATCH_SIZE)
                .getRawMany<{ id: ID }>(),
        );
    }

    private deleteUnusedClients(ctx: RequestContext): Promise<number> {
        const cutoff = new Date(Date.now() - MCP_UNUSED_OAUTH_CLIENT_RETENTION_MS);
        return deleteInBatches(this.connection, ctx, McpOauthClient, () =>
            this.connection
                .getRepository(ctx, McpOauthClient)
                .createQueryBuilder('client')
                .select('client.id', 'id')
                .leftJoin(McpOauthGrant, 'grant', 'grant.oauthClientId = client.id')
                .where('client.lastUsedAt IS NULL')
                .andWhere('client.createdAt < :cutoff', { cutoff })
                .andWhere('grant.id IS NULL')
                .limit(RETENTION_DELETE_BATCH_SIZE)
                .getRawMany<{ id: ID }>(),
        );
    }
}
