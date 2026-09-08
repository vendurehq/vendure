import { Injectable, UnauthorizedException } from '@nestjs/common';
import {
    AuthenticatedSession,
    CachedSession,
    ConfigService,
    ID,
    RequestContext,
    Session,
    SessionService,
    TransactionalConnection,
    User,
} from '@vendure/core';

import { McpOauthGrant } from '../entities/mcp-oauth-grant.entity';

import { deleteCachedVendureSession } from './oauth-utils';

/**
 * Name recorded against the dedicated Vendure session created for an MCP grant.
 */
const MCP_SESSION_STRATEGY = 'mcp-dedicated-session';

/** Used only to roll back the transaction below when another request already replaced or revoked the grant; never thrown outside this file. */
class GrantSessionAlreadyReplaced extends Error {}

/** Keeps each MCP grant's Vendure session in sync with the grant, safely even when requests race. */
@Injectable()
export class McpGrantSessionService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly sessionService: SessionService,
        private readonly configService: ConfigService,
    ) {}

    /** Safe to call on an already-revoked grant, so callers don't need to check `revokedAt` first. */
    async revokeGrant(ctx: RequestContext, grant: McpOauthGrant): Promise<void> {
        const sessionToken = await this.connection.withTransaction(ctx, async txCtx => {
            // Only one of two simultaneous revokes should win, since the loser could otherwise
            // delete a session row the winner already replaced.
            const claim = await this.connection
                .getRepository(txCtx, McpOauthGrant)
                .createQueryBuilder()
                .update(McpOauthGrant)
                .set({ revokedAt: new Date() })
                .where('id = :id', { id: grant.id })
                .andWhere('revokedAt IS NULL')
                .execute();
            if (!claim.affected) {
                return undefined;
            }
            return this.deleteVendureSessionRow(txCtx, grant.vendureSessionId);
        });
        await deleteCachedVendureSession(this.configService, sessionToken);
    }

    /** Runs as one transaction so a lapsed session is never replaced twice or left orphaned when requests race. */
    async recreateGrantSession(
        ctx: RequestContext,
        grant: McpOauthGrant,
        user: User,
    ): Promise<CachedSession> {
        const staleSessionId = grant.vendureSessionId;
        let staleSessionToken: string | undefined;
        let createdSessionToken: string | undefined;
        try {
            await this.connection.withTransaction(ctx, async txCtx => {
                // The lapsed session row may still be in the table, because Vendure clears
                // expired sessions with a background job rather than on read.
                staleSessionToken = await this.deleteVendureSessionRow(txCtx, staleSessionId);
                const created = await this.createVendureSession(txCtx, user);
                createdSessionToken = created.token;
                const claim = await this.connection
                    .getRepository(txCtx, McpOauthGrant)
                    .createQueryBuilder()
                    .update(McpOauthGrant)
                    .set({ vendureSessionId: created.id })
                    .where('id = :id', { id: grant.id })
                    .andWhere('vendureSessionId = :staleSessionId', { staleSessionId })
                    .andWhere('revokedAt IS NULL')
                    .execute();
                if (!claim.affected) {
                    throw new GrantSessionAlreadyReplaced();
                }
            });
        } catch (e) {
            if (!(e instanceof GrantSessionAlreadyReplaced)) {
                throw e;
            }
            // The session row we created was rolled back with the rest of the transaction, but
            // Core had already written it to the session cache, so that entry has to go by hand.
            await deleteCachedVendureSession(this.configService, createdSessionToken);
            return this.loadSessionOfReplacedGrant(ctx, grant);
        }

        // Deleting the stale row is only half the job: a cached session is served without
        // touching the database until its entry ages out.
        await deleteCachedVendureSession(this.configService, staleSessionToken);
        const session = createdSessionToken
            ? await this.sessionService.getSessionFromToken(createdSessionToken)
            : undefined;
        if (!session) {
            throw new UnauthorizedException('Failed to establish Vendure session');
        }
        grant.vendureSessionId = session.id;
        return session;
    }

    /** Falls back to the session another request just created, for when two requests try to replace the same lapsed session at once. */
    private async loadSessionOfReplacedGrant(
        ctx: RequestContext,
        grant: McpOauthGrant,
    ): Promise<CachedSession> {
        const current = await this.connection
            .getRepository(ctx, McpOauthGrant)
            .findOne({ where: { id: grant.id } });
        if (!current || current.revokedAt) {
            throw new UnauthorizedException('Invalid or expired access token');
        }
        const sessionRow = await this.connection
            .getRepository(ctx, Session)
            .findOne({ where: { id: current.vendureSessionId } });
        const session = sessionRow
            ? await this.sessionService.getSessionFromToken(sessionRow.token)
            : undefined;
        if (!session) {
            throw new UnauthorizedException('Failed to establish Vendure session');
        }
        grant.vendureSessionId = current.vendureSessionId;
        return session;
    }

    /** No token is supplied, so the session's identifier can't be derived from the OAuth tokens that reach it. */
    createVendureSession(ctx: RequestContext, user: User): Promise<AuthenticatedSession> {
        return this.sessionService.createNewAuthenticatedSession(ctx, user, MCP_SESSION_STRATEGY);
    }

    /** Returns the deleted session's token too, since a cached session keeps serving until its entry ages out even after the row is gone. */
    private async deleteVendureSessionRow(ctx: RequestContext, sessionId: ID): Promise<string | undefined> {
        const session = await this.connection
            .getRepository(ctx, Session)
            .findOne({ where: { id: sessionId } });
        if (!session) {
            return;
        }
        await this.connection.getRepository(ctx, Session).remove(session);
        return session.token;
    }
}
