import { DeepPartial, EntityId, ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';
import type { EmailDesign } from '../components/design';

/**
 * @description
 * The design of all emails set in the Dashboard, for one channel or for all channels (`channelId`
 * is null). Settings without a value use the code: the `branding` template variable and the
 * defaults of the email components.
 *
 * @docsCategory core plugins/Email
 * @docsPage EmailDesign
 * @since 4.0.0
 */
@Entity()
@Index(['channelId'])
export class EmailDesignOverride extends VendureEntity {
    constructor(input?: DeepPartial<EmailDesignOverride>) {
        super(input);
    }

    /** Null when the design applies to all channels. */
    @EntityId({ nullable: true })
    channelId: ID | null;

    @Column('simple-json')
    design: EmailDesign;
}
