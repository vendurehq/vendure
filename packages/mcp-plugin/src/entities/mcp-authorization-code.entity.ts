import { DeepPartial, EntityId, ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

import { McpGrantUserType } from '../types';

import { McpOauthClient } from './mcp-oauth-client.entity';

/**
 * @description
 * A short-lived authorization code from the OAuth flow, exchanged for tokens. The
 * `code` is stored as a hash. `actorId` and `actorType` record who
 * approved, so a Vendure session can be created for them when the code is exchanged.
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
     * A hash of the code handed to the client. The code itself is never stored, and the row
     * disappears the moment it is exchanged for tokens.
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
     * The endpoint this approval was for: the issuer URL plus `/mcp/admin` or `/mcp/shop`. The
     * token request has to ask for the same one.
     */
    @Column()
    resource: string;

    /**
     * @description
     * The channel the customer approved on, which the grant inherits. Null for an admin
     * approval, which is not tied to a channel.
     */
    @EntityId({ nullable: true })
    channelId: ID | null;

    @Column()
    codeChallenge: string;

    /**
     * @description
     * Always `S256`. The authorize endpoint refuses any other method.
     *
     * @default 'S256'
     */
    @Column({ default: 'S256' })
    codeChallengeMethod: string;

    /**
     * @description
     * A minute after approval by default. A code nobody exchanges in time is left for the
     * cleanup job.
     */
    @Index()
    @Column({ type: Date })
    expiresAt: Date;
}
