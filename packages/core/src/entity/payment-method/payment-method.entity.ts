import { ConfigurableOperation } from '@vendure/common/lib/generated-types';
import { DeepPartial } from '@vendure/common/lib/shared-types';
import { Column, Entity, JoinTable, ManyToMany, OneToMany } from 'typeorm';

import type { RequestContext } from '../../api/common/request-context';
import { ChannelAware } from '../../common/types/common-types';
import { LocaleString, Translatable, Translation } from '../../common/types/locale-types';
import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { VendureEntity } from '../base/base.entity';
import {
    ChannelCustomFieldsOptions,
    readChannelCustomFields,
} from '../channel-assignment/channel-custom-fields';
import { Channel } from '../channel/channel.entity';
import { CustomPaymentMethodChannelFields, CustomPaymentMethodFields } from '../custom-entity-fields';

import { PaymentMethodTranslation } from './payment-method-translation.entity';

/**
 * @description
 * A PaymentMethod is created automatically according to the configured {@link PaymentMethodHandler}s defined
 * in the {@link PaymentOptions} config.
 *
 * @docsCategory entities
 */
@Entity()
export class PaymentMethod extends VendureEntity implements Translatable, ChannelAware, HasCustomFields {
    constructor(input?: DeepPartial<PaymentMethod>) {
        super(input);
    }

    name: LocaleString;

    @Column({ default: '' }) code: string;

    description: LocaleString;

    @OneToMany(type => PaymentMethodTranslation, translation => translation.base, { eager: true })
    translations: Array<Translation<PaymentMethod>>;

    @Column() enabled: boolean;

    @Column('simple-json', { nullable: true }) checker: ConfigurableOperation | null;

    @Column('simple-json') handler: ConfigurableOperation;

    @ManyToMany(type => Channel, channel => channel.paymentMethods)
    // The junction table is owned by the channel assignment entity, which manages its schema.
    @JoinTable({ synchronize: false })
    channels: Channel[];

    @Column(type => CustomPaymentMethodFields)
    customFields: CustomPaymentMethodFields;

    /**
     * @description
     * Returns the values of the PaymentMethod's `channelScoped` custom fields in the active Channel of
     * the RequestContext (or `options.channelId`), or `undefined` if the PaymentMethod is not assigned to
     * that Channel. They are not part of `customFields`, since they have a value per Channel.
     * Declare their types on {@link CustomPaymentMethodChannelFields}.
     *
     * Relation fields are only set if listed in `options.relations`. Calls without relations made
     * in the same tick are batched into one query.
     *
     * @since 4.0.0
     */
    getChannelCustomFields(
        ctx: RequestContext,
        options?: ChannelCustomFieldsOptions<CustomPaymentMethodChannelFields>,
    ): Promise<CustomPaymentMethodChannelFields | undefined> {
        return readChannelCustomFields(ctx, PaymentMethod, this, options);
    }
}
