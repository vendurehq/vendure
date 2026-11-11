import { LanguageCode } from '@vendure/common/lib/generated-types';
import { DeepPartial, EntityId, ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

/**
 * @description
 * Text for the content slots of one email, in one language, for one channel or for all channels
 * (`channelId` is null). Slots without a value use the template's default text.
 *
 * @docsCategory core plugins/Email
 * @docsPage EmailContent
 * @since 4.0.0
 */
@Entity()
@Index(['type', 'languageCode', 'channelId'])
export class EmailContentOverride extends VendureEntity {
    constructor(input?: DeepPartial<EmailContentOverride>) {
        super(input);
    }

    /** The email type, e.g. `'order-shipped'`. */
    @Column()
    type: string;

    @Column('varchar')
    languageCode: LanguageCode;

    /** Null when the text applies to all channels. */
    @EntityId({ nullable: true })
    channelId: ID | null;

    /** Text by slot name. */
    @Column('simple-json')
    content: Record<string, string>;
}
