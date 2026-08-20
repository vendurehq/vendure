import { DeepPartial, EntityId, ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

import { McpActorType, McpToolCallStatus } from '../types';

import { McpOauthClient } from './mcp-oauth-client.entity';
import { McpOauthGrant } from './mcp-oauth-grant.entity';

/**
 * @description
 * Audit record of a single MCP tool call.
 *
 * A row exists only for a call that actually ran the tool. Calls turned away first, by a rate
 * limit, a permission check, an unknown or switched-off tool, bad arguments, or because the
 * tool asked for confirmation, leave no trace here.
 *
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
@Index(['createdAt'])
@Entity()
export class McpToolCallLog extends VendureEntity {
    constructor(input?: DeepPartial<McpToolCallLog>) {
        super(input);
    }

    /**
     * @description
     * Null when the call did not arrive over OAuth, and set back to null if the cleanup job
     * later deletes the grant.
     */
    @Index()
    @ManyToOne(() => McpOauthGrant, { nullable: true, onDelete: 'SET NULL' })
    grant: McpOauthGrant | null;

    @EntityId({ nullable: true })
    grantId: ID | null;

    /**
     * @description
     * Id of the user the call ran as. Null when nobody was signed in.
     */
    @Column({ type: 'varchar', nullable: true })
    actor: string | null;

    /**
     * @description
     * A call made with an OAuth token copies the type from its grant. Otherwise an Admin API
     * call is `admin`, a signed-in shopper is `customer`, and a guest is `anonymous`.
     */
    @Column({ type: 'varchar' })
    actorType: McpActorType;

    /**
     * @description
     * Null unless you switch on `logging.captureClientIp`, and null for calls that never came
     * over HTTP. The Admin API also hides it from anyone without the `ReadCustomer` permission.
     */
    @Column({ type: 'varchar', nullable: true })
    clientIp: string | null;

    /**
     * @description
     * Null means the row shows up on every channel. A call made with an OAuth token uses that
     * grant's channel, which is itself null for an admin grant.
     */
    @Index()
    @EntityId({ nullable: true })
    channelId: ID | null;

    @Index()
    @Column()
    toolName: string;

    /**
     * @description
     * The plugin that registered the tool, or `unknown` if it could not be traced back to one.
     */
    @Column({ type: 'varchar', nullable: true })
    pluginSource: string | null;

    /**
     * @description
     * The arguments the tool ran with, after your `logging.redact` function has seen them.
     * Stored only when `logging.capture` is `full`, and left null if `redact` throws or the
     * body is larger than `logging.maxBodyBytes`. The Admin API also hides it from anyone
     * without the `ReadCustomer` permission.
     */
    @Column({ type: 'simple-json', nullable: true })
    input: unknown;

    /**
     * @description
     * What the tool returned, stored under the same rules as `input`. On a failed call it holds
     * the error message instead.
     */
    @Column({ type: 'simple-json', nullable: true })
    output: unknown;

    @Index()
    @Column({ type: 'int', nullable: true })
    durationMs: number | null;

    @Index()
    @Column({ type: 'varchar' })
    status: McpToolCallStatus;

    /**
     * @description
     * Null when the call did not arrive over OAuth, and set back to null if the client is
     * deleted.
     */
    @Index()
    @ManyToOne(() => McpOauthClient, { nullable: true, onDelete: 'SET NULL' })
    oauthClient: McpOauthClient | null;

    @EntityId({ nullable: true })
    oauthClientId: ID | null;
}
