import { LanguageCode } from '@vendure/common/lib/generated-types';
import { DeepPartial } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

import { Translation } from '../../common/types/locale-types';
import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { VendureEntity } from '../base/base.entity';
import { CustomProductOptionFieldsTranslation } from '../custom-entity-fields';

import { ProductOption } from './product-option.entity';

@Entity()
export class ProductOptionTranslation
    extends VendureEntity
    implements Translation<ProductOption>, HasCustomFields
{
    constructor(input?: DeepPartial<Translation<ProductOption>>) {
        super(input);
    }

    @Column('varchar') languageCode: LanguageCode;

    @Column() name: string;

    @Index()
    @ManyToOne(type => ProductOption, base => base.translations, { onDelete: 'CASCADE' })
    base: ProductOption;

    @Column(type => CustomProductOptionFieldsTranslation)
    customFields: CustomProductOptionFieldsTranslation;
}
