import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Column, Entity, JoinTable, ManyToMany, ManyToOne, OneToMany } from 'typeorm';

import { Channel } from '..';
import { ChannelAware, LocaleString, SoftDeletable, Translatable, Translation } from '../../common';
import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { VendureEntity } from '../base/base.entity';
import { CustomApiKeyFields } from '../custom-entity-fields';
import { EntityId } from '../entity-id.decorator';
import { User } from '../user/user.entity';

import { ApiKeyTranslation } from './api-key-translation.entity';

/**
 * @description
 * An ApiKey is mostly used for authenticating non-interactive clients such as scripts
 * or other types of services. An ApiKey is associated with a {@link User} whose
 * permissions will apply when the ApiKey is used for authorization.
 *
 * Similar to how passwords are handled, only a hash of the API key is stored in the database
 * meaning, generated API-Keys are not viewable after creation, Users are responsible for storing them.
 *
 * Hence, if a User forgets their ApiKey, the old one must be deleted and a new one created.
 * This is called "rotating" an ApiKey.
 *
 * @docsCategory entities
 */
@Entity()
export class ApiKey
    extends VendureEntity
    implements HasCustomFields, ChannelAware, Translatable, SoftDeletable
{
    constructor(input?: DeepPartial<ApiKey>) {
        super(input);
    }

    /**
     * ID by which we can look up the API-Key.
     * Also helps you identify keys without leaking the underlying secret API-Key.
     */
    @Column({ unique: true })
    lookupId: string;

    @Column({ unique: true })
    apiKeyHash: string;

    @Column({ type: Date, nullable: true })
    lastUsedAt: Date | null;

    @Column({ type: Date, nullable: true })
    deletedAt: Date | null;

    /**
     * Usually the user who created the ApiKey but could also be used as the basis for
     * restricting resolvers to `Permission.Owner` queries for customers for example.
     */
    @ManyToOne(type => User)
    owner: User;

    @EntityId()
    ownerId: ID;

    /**
     * This is the underlying User which determines the kind of permissions for this API-Key.
     */
    @ManyToOne(type => User)
    user: User;

    @EntityId()
    userId: ID;

    @ManyToMany(() => Channel)
    @JoinTable()
    channels: Channel[];

    @OneToMany(() => ApiKeyTranslation, t => t.base, { eager: true })
    translations: Array<Translation<ApiKey>>;

    @Column(type => CustomApiKeyFields)
    customFields: CustomApiKeyFields;

    name: LocaleString;
}
