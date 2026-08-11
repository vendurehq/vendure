import { DeepPartial, EntityId, ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

import { McpActorType } from '../types';

import { McpOauthClient } from './mcp-oauth-client.entity';

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
    userId: ID;

    @Column({ type: 'varchar' })
    userType: McpActorType;

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
}
