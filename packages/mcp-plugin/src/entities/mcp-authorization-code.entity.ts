import { DeepPartial, EntityId, ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

import { McpActorType } from '../types';

import { McpOauthClient } from './mcp-oauth-client.entity';

/**
 * @description
 * A short-lived authorization code from the OAuth flow, exchanged for tokens. The
 * `code` is stored as a hash. `userId` and `userType` record who
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

    @Index({ unique: true })
    @Column()
    code: string;

    @Index()
    @ManyToOne(() => McpOauthClient, { onDelete: 'CASCADE' })
    oauthClient: McpOauthClient;

    @EntityId()
    oauthClientId: ID;

    // Identity columns used by the token-exchange step to create a Vendure session.
    @Index()
    @EntityId()
    userId: ID;

    @Column({ type: 'varchar' })
    userType: McpActorType;

    @Column()
    redirectUri: string;

    @Index()
    @Column()
    resource: string;

    // Optional channel scoping for the granted session.
    @Index()
    @EntityId({ nullable: true })
    channelId: ID | null;

    @Column()
    codeChallenge: string;

    @Column({ default: 'S256' })
    codeChallengeMethod: string;

    @Index()
    @Column({ type: Date })
    expiresAt: Date;
}
