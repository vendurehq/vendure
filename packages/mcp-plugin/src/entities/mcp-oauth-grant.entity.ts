import { Calculated, DeepPartial, EntityId, ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { DateUtils } from 'typeorm/util/DateUtils';

import { McpGrantUserType } from '../types';

import { McpOauthClient } from './mcp-oauth-client.entity';

/**
 * @description
 * The three states a grant can be in. Their alphabetical order is also their
 * lifecycle order, so sorting by status ascending runs active, expired, revoked.
 *
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
export type McpOauthGrantStatus = 'active' | 'expired' | 'revoked';

/**
 * @description
 * Represents one MCP OAuth grant: the hashed access + refresh token pair issued to a
 * client, the granting user, and the dedicated Vendure session created for the grant.
 *
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
@Entity()
export class McpOauthGrant extends VendureEntity {
    constructor(input?: DeepPartial<McpOauthGrant>) {
        super(input);
    }

    /**
     * @description
     * A hash of the access token, which is how a request finds its grant. The token itself is
     * never stored, and every refresh replaces this hash.
     */
    @Index({ unique: true })
    @Column()
    accessTokenHash: string;

    /**
     * @description
     * A hash of the refresh token. The token itself is never stored, and every refresh replaces
     * this hash.
     */
    @Index({ unique: true })
    @Column()
    refreshTokenHash: string;

    /**
     * @description
     * A hash of the refresh token the last refresh replaced. Null until the first refresh. If a
     * client turns up with this old token, the server assumes it was stolen and revokes the
     * grant.
     */
    @Index()
    @Column({ type: 'varchar', nullable: true })
    previousRefreshTokenHash: string | null;

    @Index()
    @ManyToOne(() => McpOauthClient, { onDelete: 'CASCADE' })
    oauthClient: McpOauthClient;

    @EntityId()
    oauthClientId: ID;

    /**
     * @description
     * The user who approved this grant. Tool calls made with it run as that user.
     */
    @Index()
    @EntityId()
    actorId: ID;

    /**
     * @description
     * Whether an administrator or a customer approved this grant. It also decides which MCP
     * endpoint the grant's tokens may call.
     */
    @Column({ type: 'varchar' })
    actorType: McpGrantUserType;

    /**
     * @description
     * The one endpoint these tokens work against: the issuer URL plus `/mcp/admin` or
     * `/mcp/shop`. Presenting a token anywhere else is refused.
     */
    @Column()
    resource: string;

    /**
     * @description
     * When the current access token stops working. Every refresh pushes it out again by the
     * configured access-token lifetime.
     */
    @Index()
    @Column({ type: Date })
    accessTokenExpiresAt: Date;

    /**
     * @description
     * When the grant itself dies, set from the refresh-token lifetime. Every refresh pushes it
     * out again, so a client that keeps refreshing keeps the grant alive.
     */
    @Index()
    @Column({ type: Date })
    expiresAt: Date;

    /**
     * @description
     * Null while the grant still works. An administrator, the customer, or the client itself
     * can revoke it, and the server does so on its own if an already-replaced refresh token
     * comes back.
     */
    @Index()
    @Column({ type: Date, nullable: true })
    revokedAt: Date | null;

    /**
     * @description
     * The Vendure session this grant's tool calls run in. Revoking the grant deletes that
     * session, and so does the cleanup job once the grant has expired.
     */
    @Index()
    @EntityId()
    vendureSessionId: ID;

    /**
     * @description
     * The channel the customer approved on. Null for an admin grant, whose calls run on the
     * default channel.
     */
    @Index()
    @EntityId({ nullable: true })
    channelId: ID | null;

    /**
     * @description
     * Updated on every refresh, and by tool calls at most once a minute, so it lags real
     * activity by up to that long.
     */
    @Index()
    @Column({ type: Date })
    lastActivityAt: Date;

    /**
     * @description
     * Worked out on read rather than stored, so it is always current without anything having to
     * update it.
     */
    @Calculated({
        query: qb => qb.setParameter('grant_status_now', DateUtils.mixedDateToUtcDatetimeString(new Date())),
        expression: `CASE WHEN mcpoauthgrant.revokedAt IS NOT NULL THEN 'revoked' WHEN mcpoauthgrant.expiresAt <= :grant_status_now THEN 'expired' ELSE 'active' END`,
    })
    get status(): McpOauthGrantStatus {
        if (this.revokedAt != null) {
            return 'revoked';
        }
        return this.expiresAt.getTime() <= Date.now() ? 'expired' : 'active';
    }
}
