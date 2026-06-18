import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

import { EntityId } from '../../../entity/entity-id.decorator';
import { Money } from '../../../entity/money.decorator';

@Entity()
export class SearchIndexItem {
    constructor(input?: Partial<SearchIndexItem>) {
        if (input) {
            for (const [key, value] of Object.entries(input)) {
                (this as any)[key] = value;
            }
        }
    }

    @EntityId({ primary: true })
    productVariantId: ID;

    @PrimaryColumn('varchar')
    languageCode: LanguageCode;

    @EntityId({ primary: true })
    channelId: ID;

    @EntityId()
    productId: ID;

    @Column()
    enabled: boolean;

    @Index({ fulltext: true })
    @Column()
    productName: string;

    @Index({ fulltext: true })
    @Column()
    productVariantName: string;

    @Index({ fulltext: true })
    @Column('text')
    description: string;

    @Column()
    slug: string;

    @Column()
    sku: string;

    @Money()
    price: number;

    @Money()
    priceWithTax: number;

    @Column('simple-array')
    facetIds: string[];

    @Column('simple-array')
    facetValueIds: string[];

    @Column('simple-array')
    collectionIds: string[];

    @Column('simple-array')
    collectionSlugs: string[];

    @Column('simple-array')
    channelIds: string[];

    @Column()
    productPreview: string;

    @Column('simple-json', { nullable: true })
    productPreviewFocalPoint?: { x: number; y: number } | null;

    @Column()
    productVariantPreview: string;

    @Column('simple-json', { nullable: true })
    productVariantPreviewFocalPoint?: { x: number; y: number } | null;

    @EntityId({ nullable: true })
    productAssetId: ID | null;

    @EntityId({ nullable: true })
    productVariantAssetId: ID | null;

    // Added dynamically based on the `indexStockStatus` init option.
    inStock?: boolean;
    // Added dynamically based on the `indexStockStatus` init option.
    productInStock?: boolean;
    // Added dynamically based on the `indexCurrencyCode` init option.
    currencyCode?: CurrencyCode;
}
