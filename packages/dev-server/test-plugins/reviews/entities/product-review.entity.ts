import {
    Customer,
    DeepPartial,
    HasCustomFields,
    LocaleString,
    Product,
    ProductVariant,
    Translatable,
    Translation,
    VendureEntity,
} from '@vendure/core';
import { Column, Entity, ManyToOne, OneToMany } from 'typeorm';
import { ReviewState } from '../types';
import { ProductReviewTranslation } from './product-review-translation.entity';

export class CustomReviewFields {}
@Entity()
export class ProductReview extends VendureEntity implements Translatable, HasCustomFields {
    constructor(input?: DeepPartial<ProductReview>) {
        super(input);
    }
    @ManyToOne(type => Product)
    product: Product;

    text: LocaleString;

    @ManyToOne(type => ProductVariant)
    productVariant: ProductVariant | null;

    @Column()
    summary: string;

    @Column('text')
    body: string;

    @Column()
    rating: number;

    @ManyToOne(type => Customer)
    author: Customer;

    @Column()
    authorName: string;

    @Column({ nullable: true })
    authorLocation: string;

    @Column({ default: 0 })
    upvotes: number;

    @Column({ default: 0 })
    downvotes: number;

    @Column('varchar')
    state: ReviewState;

    @Column('text', { nullable: true, default: null })
    response: string;

    @Column({ nullable: true, default: null })
    responseCreatedAt: Date;

    @OneToMany(() => ProductReviewTranslation, translation => translation.base, { eager: true })
    translations: Array<Translation<ProductReview>>;

    @Column(type => CustomReviewFields)
    customFields: CustomReviewFields;
}
