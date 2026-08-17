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

    @Index({ unique: true })
    @Column()
    accessTokenHash: string;

    @Index({ unique: true })
    @Column()
    refreshTokenHash: string;

    /**
     * Hash of the refresh token that was rotated away. A lookup landing here means
     * the old token was presented again after rotation — treated as theft, revoking
     * the grant.
     */
    @Index()
    @Column({ type: 'varchar', nullable: true })
    previousRefreshTokenHash: string | null;

    @Index()
    @ManyToOne(() => McpOauthClient, { onDelete: 'CASCADE' })
    oauthClient: McpOauthClient;

    @EntityId()
    oauthClientId: ID;

    @Index()
    @EntityId()
    actorId: ID;

    @Column({ type: 'varchar' })
    actorType: McpGrantUserType;

    @Column()
    resource: string;

    @Index()
    @Column({ type: Date })
    accessTokenExpiresAt: Date;

    @Index()
    @Column({ type: Date })
    expiresAt: Date;

    @Index()
    @Column({ type: Date, nullable: true })
    revokedAt: Date | null;

    @Index()
    @EntityId()
    vendureSessionId: ID;

    @Index()
    @EntityId({ nullable: true })
    channelId: ID | null;

    @Index()
    @Column({ type: Date })
    lastActivityAt: Date;

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
