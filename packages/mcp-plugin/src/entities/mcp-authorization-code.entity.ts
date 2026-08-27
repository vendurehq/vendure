import { DeepPartial, EntityId, ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

import { McpGrantUserType } from '../types';

import { McpOauthClient } from './mcp-oauth-client.entity';

/**
 * @description
 * Short-lived OAuth authorization code exchanged for tokens.
 * The code is stored as a hash. Actor info is kept to recreate the session on exchange.
 *
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
@Entity()
export class McpAuthorizationCode extends VendureEntity {
    constructor(input?: DeepPartial<McpAuthorizationCode>) {
        super(input);
    }

    /**
     * @description
     * Hash of the authorization code. The raw code is never stored and is deleted after use.
     */
    @Index({ unique: true })
    @Column()
    code: string;

    @Index()
    @ManyToOne(() => McpOauthClient, { onDelete: 'CASCADE' })
    oauthClient: McpOauthClient;

    @EntityId()
    oauthClientId: ID;

    @EntityId()
    actorId: ID;

    @Column({ type: 'varchar' })
    actorType: McpGrantUserType;

    @Column()
    redirectUri: string;

    /**
     * @description
     * Target endpoint (issuer + `/mcp/admin` or `/mcp/shop`).
     * Must match during token exchange.
     */
    @Column()
    resource: string;

    @EntityId({ nullable: true })
    channelId: ID | null;

    @Column()
    codeChallenge: string;

    /**
     * @description
     * PKCE method. Always `S256`
     *
     * @default 'S256'
     */
    @Column({ default: 'S256' })
    codeChallengeMethod: string;

    @Index()
    @Column({ type: Date })
    expiresAt: Date;
}
