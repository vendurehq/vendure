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

/**
 * Thrown inside the session re-creation transaction purely to roll it back, when another
 * request has already given the grant a new session or revoked it. Never leaves this file.
 */
class GrantSessionAlreadyReplaced extends Error {}

/**
 * Owns the one Vendure session row and one session-cache entry that back each MCP grant.
 *
 * Creates that session when a grant is issued, replaces it when it lapses, and deletes it
 * when the grant is revoked. Each step runs under the grant's own concurrency rules, so
 * simultaneous requests never leave an orphaned session behind.
 */
@Injectable()
export class McpGrantSessionService {
    constructor(
        private connection: TransactionalConnection,
        private sessionService: SessionService,
        private configService: ConfigService,
    ) {}

    /**
     * Marks the grant revoked and deletes its Vendure session. A grant that is already revoked
     * is left alone, so callers do not need to check `revokedAt` first.
     */
    async revokeGrant(ctx: RequestContext, grant: McpOauthGrant): Promise<void> {
        const sessionToken = await this.connection.withTransaction(ctx, async txCtx => {
            // Conditional on the grant still being live, so that when two callers revoke the
            // same grant at once only one of them matches. The loser must not go on to delete
            // a session row, because by then the winner may already have replaced it.
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

    /**
     * Atomically replaces a lapsed Vendure session for an active grant.
     *
     * Runs in a single transaction to prevent orphaned active sessions, using
     * conditional updates to safely handle race conditions and concurrent revocations.
     */
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

    /**
     * Reads back a grant whose session another request replaced while this one was building its
     * own, and returns that session. If the grant turns out to have been revoked instead, or its
     * new session is unusable, this request has nothing to run on.
     */
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

    /**
     * Creates the dedicated Vendure session for a grant. No token is supplied, so Core
     * generates an ordinary random one — nothing about the session is derivable from
     * the OAuth tokens that reach it.
     */
    createVendureSession(ctx: RequestContext, user: User): Promise<AuthenticatedSession> {
        return this.sessionService.createNewAuthenticatedSession(ctx, user, MCP_SESSION_STRATEGY);
    }

    /**
     * Removes a Vendure session row by id, if it still exists, and returns the token it
     * held so the caller can evict the cache entry. Deleting the row alone is not enough:
     * a cached session is served without touching the database until its entry ages out.
     */
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
