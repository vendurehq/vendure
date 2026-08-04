import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

/**
 * @description
 * Metadata for an MCP client registered via OAuth Dynamic Client Registration, or resolved
 * from a Client ID Metadata Document (CIMD) URL
 *
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
@Entity()
export class McpOauthClient extends VendureEntity {
    constructor(input?: DeepPartial<McpOauthClient>) {
        super(input);
    }

    /**
     * A random token for a client that registered itself, or the URL of its metadata document
     * (CIMD). The explicit length is for the URL case: MySQL's varchar columns would otherwise
     * default to 255 characters, which real metadata URLs can exceed.
     */
    @Index({ unique: true })
    @Column({ length: 512 })
    clientId: string;

    @Column()
    clientName: string;

    @Column({ type: 'varchar', nullable: true })
    clientUri: string | null;

    @Column({ type: 'varchar', nullable: true })
    logoUri: string | null;

    @Column({ type: 'simple-json' })
    redirectUris: string[];

    @Column({ type: 'simple-json' })
    grantTypes: string[];

    @Column({ default: 'none' })
    tokenEndpointAuthMethod: string;

    /**
     * How the record came to exist: `'dcr'` for Dynamic Client Registration, `'cimd'` for a
     * client resolved from a client_id metadata document URL.
     */
    @Column({ default: 'dcr' })
    clientType: 'dcr' | 'cimd';

    @Column({ type: Date, nullable: true })
    cimdDocumentExpiresAt: Date | null;

    @Column({ type: Date, nullable: true })
    lastUsedAt: Date | null;
}
