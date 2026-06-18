import { DeepPartial } from '@vendure/common/lib/shared-types';
import { HasCustomFields, LanguageCode, Translation, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

import { ProductReview } from './product-review.entity';

export class CustomReviewFieldsTranslation {}

@Entity()
export class ProductReviewTranslation
    extends VendureEntity
    implements Translation<ProductReview>, HasCustomFields
{
    constructor(input?: DeepPartial<ProductReviewTranslation>) {
        super(input);
    }

    @Column('varchar')
    languageCode: LanguageCode;

    @Column('varchar')
    text: string; // same name as the translatable field in the base entity

    @Index()
    @ManyToOne(() => ProductReview, base => base.translations, { onDelete: 'CASCADE' })
    base: ProductReview;

    @Column(type => CustomReviewFieldsTranslation)
    customFields: CustomReviewFieldsTranslation;
}
