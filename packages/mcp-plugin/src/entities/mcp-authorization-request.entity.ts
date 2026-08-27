import { DeepPartial, EntityId, ID, VendureEntity } from '@vendure/core';
import { McpToolset } from '@vendure/mcp-sdk';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

import { McpOauthClient } from './mcp-oauth-client.entity';

/**
 * @description
 * Pending OAuth authorization request before user consent.
 * Stores redirect info, PKCE challenge, and a hashed request token.
 *
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
@Entity()
export class McpAuthorizationRequest extends VendureEntity {
    constructor(input?: DeepPartial<McpAuthorizationRequest>) {
        super(input);
    }

    /**
     * @description
     * Hash of the request token used by the consent page.
     */
    @Index({ unique: true })
    @Column()
    requestToken: string;

    @Index()
    @ManyToOne(() => McpOauthClient, { onDelete: 'CASCADE' })
    oauthClient: McpOauthClient;

    @EntityId()
    oauthClientId: ID;

    @Column()
    redirectUri: string;

    @Column({ type: 'varchar', nullable: true })
    state: string | null;

    @Column()
    codeChallenge: string;

    /**
     * @description
     * PKCE method. Always `S256`.
     *
     * @default 'S256'
     */
    @Column({ default: 'S256' })
    codeChallengeMethod: string;

    @Column({ type: 'varchar' })
    toolset: McpToolset;

    /**
     * @description
     * Target endpoint (issuer + `/mcp/admin` or `/mcp/shop`).
     */
    @Column()
    resource: string;

    @Index()
    @Column({ type: Date })
    expiresAt: Date;
}
