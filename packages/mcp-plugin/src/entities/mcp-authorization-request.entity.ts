import { DeepPartial, EntityId, ID, VendureEntity } from '@vendure/core';
import { McpToolset } from '@vendure/mcp-sdk';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

import { McpOauthClient } from './mcp-oauth-client.entity';

/**
 * @description
 * A pending OAuth authorization request, saved before the user consents. Holds the
 * PKCE challenge and redirect parameters, plus a short-lived `requestToken` (stored
 * as a hash) that links the consent page back to this request.
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
     * A hash of the token that the consent page carries in its URL. The token itself is never
     * stored.
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
     * Always `S256`. The authorize endpoint refuses any other method.
     *
     * @default 'S256'
     */
    @Column({ default: 'S256' })
    codeChallengeMethod: string;

    /**
     * @description
     * Decides which consent page the browser is sent to, and which of the two approval
     * mutations is allowed to answer this request.
     */
    @Column({ type: 'varchar' })
    toolset: McpToolset;

    /**
     * @description
     * The endpoint being asked for: the issuer URL plus `/mcp/admin` or `/mcp/shop`.
     */
    @Column()
    resource: string;

    /**
     * @description
     * How long the user has to decide, ten minutes by default. A request nobody answers is left
     * for the cleanup job.
     */
    @Index()
    @Column({ type: Date })
    expiresAt: Date;
}
