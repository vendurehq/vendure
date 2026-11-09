import { LanguageCode } from '@vendure/common/lib/generated-types';
import { DeepPartial } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

import { Translation } from '../../common/types/locale-types';
import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { VendureEntity } from '../base/base.entity';
import { CustomSellerFieldsTranslation } from '../custom-entity-fields';

import { Seller } from './seller.entity';

@Entity()
export class SellerTranslation extends VendureEntity implements Translation<Seller>, HasCustomFields {
    constructor(input?: DeepPartial<Translation<Seller>>) {
        super(input);
    }

    @Column('varchar') languageCode: LanguageCode;

    @Index()
    @ManyToOne(type => Seller, base => base.translations, { onDelete: 'CASCADE' })
    base: Seller;

    @Column(type => CustomSellerFieldsTranslation)
    customFields: CustomSellerFieldsTranslation;
}
