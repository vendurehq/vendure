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

    /**
     * Cleans up Vendure sessions for expired or revoked grants.
     * Prevents expired grants from retaining active GraphQL sessions and ensures
     * orphaned sessions don't outlive their grant records.
     */
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

    /**
     * Deletes authorization requests or codes that have expired without ever being used. Their
     * lifetimes are 10 minutes and 60 seconds; a used one is deleted immediately by the atomic
     * claim that consumes it, so this only ever catches abandoned flows.
     */
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

    /**
     * Deletes grants that have been dead — expired or revoked — for longer than
     * `oauth.grantRetentionDays`. The row outlives the authorization it recorded because it is the
     * only OAuth record with audit value; the option's default matches the tool-call log window so
     * that, out of the box, every retained log can still resolve the grant it points at.
     */
    private deleteDeadGrants(ctx: RequestContext): Promise<number> {
        const oauth = this.options.oauth;
        if (!oauth) {
            return Promise.resolve(0);
        }
        if (oauth.grantRetentionDays === 0) {
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

    /**
     * Deletes client registrations that were never used: older than
     * `MCP_UNUSED_OAUTH_CLIENT_RETENTION_MS`, never issued a token (`lastUsedAt IS NULL`),
     * and with no grants.
     */
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
