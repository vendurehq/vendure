import { DeepPartial, EntityId, ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

import { McpActorType, McpToolCallStatus } from '../types';

import { McpOauthClient } from './mcp-oauth-client.entity';
import { McpOauthGrant } from './mcp-oauth-grant.entity';

/**
 * @description
 * Audit record of a single MCP tool call.
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

    @Index()
    @ManyToOne(() => McpOauthGrant, { nullable: true, onDelete: 'SET NULL' })
    grant: McpOauthGrant | null;

    @EntityId({ nullable: true })
    grantId: ID | null;

    @Column({ type: 'varchar', nullable: true })
    actor: string | null;

    @Column({ type: 'varchar' })
    actorType: McpActorType;

    @Column({ type: 'varchar', nullable: true })
    clientIp: string | null;

    @Index()
    @EntityId({ nullable: true })
    channelId: ID | null;

    @Index()
    @Column()
    toolName: string;

    @Column({ type: 'varchar', nullable: true })
    pluginSource: string | null;

    @Column({ type: 'simple-json', nullable: true })
    input: unknown | null;

    @Column({ type: 'simple-json', nullable: true })
    output: unknown | null;

    @Index()
    @Column({ type: 'int', nullable: true })
    durationMs: number | null;

    @Index()
    @Column({ type: 'varchar' })
    status: McpToolCallStatus;

    @Index()
    @ManyToOne(() => McpOauthClient, { nullable: true, onDelete: 'SET NULL' })
    oauthClient: McpOauthClient | null;

    @EntityId({ nullable: true })
    oauthClientId: ID | null;
}
