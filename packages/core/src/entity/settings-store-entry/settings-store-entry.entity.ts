import { Column, Entity, Index } from 'typeorm';

import { VendureEntity } from '../base/base.entity';

/**
 * @description
 * An entity for storing arbitrary settings data with scoped isolation.
 * This is used by the SettingsStore system to provide flexible key-value storage
 * with support for user, channel, and custom scoping.
 *
 * @docsCategory entities
 * @docsPage SettingsStoreEntry
 * @since 3.4.0
 */
@Entity()
@Index('settings_store_key_scope_unique', ['key', 'scope'], { unique: true })
export class SettingsStoreEntry extends VendureEntity {
    constructor(input?: Partial<SettingsStoreEntry>) {
        super(input);
    }

    /**
     * @description
     * The settings key, typically in the format 'namespace.fieldName'
     */
    @Index()
    @Column()
    key: string;

    /**
     * @description
     * The JSON value stored for this setting
     */
    @Column('json', { nullable: true })
    value: any | null;

    /**
     * @description
     * The scope string that isolates this setting (e.g., 'user:123', 'channel:456', '')
     */
    @Index()
    @Column({ type: 'varchar', nullable: true })
    scope: string | null;
}
