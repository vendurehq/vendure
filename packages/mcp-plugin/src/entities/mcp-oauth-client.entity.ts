import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

/**
 * @description
 * Metadata for an MCP client registered via OAuth Dynamic Client Registration, or resolved
 * from a Client ID Metadata Document (CIMD) URL.
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
     * @description
     * Unique client identifier (generated or metadata URL).
     */
    @Index({ unique: true })
    @Column({ length: 512 })
    clientId: string;

    /**
     * @description
     * The name the client picked for itself, shown to whoever is asked to approve it. Nothing
     * verifies it, so treat it as untrusted.
     */
    @Column()
    clientName: string;

    /**
     * @description
     * Homepage shown on the consent page. Null if the client sent none, or sent something that
     * was not a valid `https` URL.
     */
    @Column({ type: 'varchar', nullable: true })
    clientUri: string | null;

    /**
     * @description
     * Client logo URL (HTTPS only).
     */
    @Column({ type: 'varchar', nullable: true })
    logoUri: string | null;

    @Column({ type: 'simple-json' })
    redirectUris: string[];

    /**
     * @description
     * Only `authorization_code` and `refresh_token` are accepted. Anything else a client asks
     * for is dropped.
     */
    @Column({ type: 'simple-json' })
    grantTypes: string[];

    /**
     * @description
     * Always `none`. This server issues no client secrets, and refuses any other value at
     * registration.
     *
     * @default 'none'
     */
    @Column({ default: 'none' })
    tokenEndpointAuthMethod: string;

    /**
     * @description
     * When the cached copy of the client's metadata document goes stale and must be fetched
     * again. Null for a client that registered itself and has no document.
     */
    @Column({ type: Date, nullable: true })
    cimdDocumentExpiresAt: Date | null;

    @Column({ type: Date, nullable: true })
    lastUsedAt: Date | null;
}
