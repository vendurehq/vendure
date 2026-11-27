import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index, ManyToMany, ManyToOne } from 'typeorm';

import { Customer, PaymentMethod, Promotion, ShippingMethod, StockLocation } from '..';
import { ApiKey } from '../api-key/api-key.entity';
import { VendureEntity } from '../base/base.entity';
import { Collection } from '../collection/collection.entity';
import { CustomChannelFields } from '../custom-entity-fields';
import { EntityId } from '../entity-id.decorator';
import { FacetValue } from '../facet-value/facet-value.entity';
import { Facet } from '../facet/facet.entity';
import { ProductOptionGroup } from '../product-option-group/product-option-group.entity';
import { ProductOption } from '../product-option/product-option.entity';
import { ProductVariant } from '../product-variant/product-variant.entity';
import { Product } from '../product/product.entity';
import { Seller } from '../seller/seller.entity';
import { Zone } from '../zone/zone.entity';

/**
 * @description
 * A Channel represents a distinct sales channel and configures defaults for that
 * channel.
 *
 * * Set a channel-specific currency, language, tax and shipping defaults
 * * Assign only specific Products to the Channel (with Channel-specific prices)
 * * Create Administrator roles limited to the Channel
 * * Assign only specific StockLocations, Assets, Facets, Collections, Promotions, ShippingMethods & PaymentMethods to the Channel
 * * Have Orders and Customers associated with specific Channels.
 *
 * In Vendure, Channels have a number of different uses, such as:
 *
 * * Multi-region stores, where there is a distinct website for each territory with its own available inventory, pricing, tax and shipping rules.
 * * Creating distinct rules and inventory for different sales channels such as Amazon.
 * * Specialized stores offering a subset of the main inventory.
 * * Implementing multi-vendor marketplace applications.
 *
 * @docsCategory entities
 */
@Entity()
export class Channel extends VendureEntity {
    constructor(input?: DeepPartial<Channel>) {
        super(input);
        if (!input || !input.token) {
            this.token = this.generateToken();
        }
    }

    /**
     * @description
     * The name of the Channel. For example "US Webstore" or "German Webstore".
     */
    @Column({ unique: true })
    code: string;

    /**
     * @description
     * A unique token (string) used to identify the Channel in the `vendure-token` header of the
     * GraphQL API requests.
     */
    @Column({ unique: true })
    token: string;

    @Column({ default: '', nullable: true })
    description: string;

    @Index()
    @ManyToOne(type => Seller, seller => seller.channels)
    seller?: Seller;

    @EntityId({ nullable: true })
    sellerId?: ID;

    @Column('varchar') defaultLanguageCode: LanguageCode;

    @Column({ type: 'simple-array', nullable: true })
    availableLanguageCodes: LanguageCode[];

    @Index()
    @ManyToOne(type => Zone, zone => zone.defaultTaxZoneChannels)
    defaultTaxZone: Zone;

    @Index()
    @ManyToOne(type => Zone, zone => zone.defaultShippingZoneChannels)
    defaultShippingZone: Zone;

    @Column('varchar')
    defaultCurrencyCode: CurrencyCode;

    @Column({ type: 'simple-array', nullable: true })
    availableCurrencyCodes: CurrencyCode[];

    /**
     * @description
     * Whether inventory is tracked for the ProductVariants and StockLevels of this Channel whose
     * `trackInventory` is `INHERIT`. ProductVariants and StockLevels can override it.
     *
     * @since 4.0.0 - Used as the default; it was not read before
     */
    @Column({ default: true })
    trackInventory: boolean;

    /**
     * @description
     * The stock level below which a ProductVariant with `useGlobalOutOfStockThreshold` may not be
     * sold in this Channel. A negative value allows backorders. Variants with
     * `useGlobalOutOfStockThreshold: false` use their own `outOfStockThreshold` instead.
     *
     * @since 4.0.0 - Used for those variants; it was not read before
     */
    @Column({ default: 0 })
    outOfStockThreshold: number;

    @Column(type => CustomChannelFields)
    customFields: CustomChannelFields;

    @Column() pricesIncludeTax: boolean;

    /**
     * @description
     * The code of the country whose tax rate the Channel's tax-inclusive prices include: the
     * seller's own country. When it is set, a tax-inclusive price is split into net and tax at the
     * country rate of this country, or at the zone rate of the default tax Zone when there is no
     * country rate. See {@link TaxRateService}`.findIncludedTaxRate()`.
     *
     * It is also the tax country of prices with no shipping country, such as product pages and
     * carts before an address is set, when the active tax Zone is the default tax Zone. See
     * {@link defaultTaxCountryCode}.
     *
     * The country should be a member of the default tax Zone. When it is not set, the default tax
     * Zone's zone rate is the included rate.
     *
     * @since 4.0.0
     */
    @Column({ type: 'varchar', nullable: true })
    taxCountryCode: string | null;

    // Declared explicitly: TypeORM 1.1.1+ defaults an undeclared inverse junction FK rule to CASCADE (#5594).
    @ManyToMany(type => Product, product => product.channels, {
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
    })
    products: Product[];

    @ManyToMany(type => ProductVariant, productVariant => productVariant.channels, {
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
    })
    productVariants: ProductVariant[];

    @ManyToMany(type => FacetValue, facetValue => facetValue.channels, {
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
    })
    facetValues: FacetValue[];

    @ManyToMany(type => Facet, facet => facet.channels, {
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
    })
    facets: Facet[];

    @ManyToMany(type => ProductOptionGroup, pog => pog.channels, {
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
    })
    productOptionGroups: ProductOptionGroup[];

    @ManyToMany(type => ProductOption, po => po.channels, {
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
    })
    productOptions: ProductOption[];

    @ManyToMany(type => Collection, collection => collection.channels, {
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
    })
    collections: Collection[];

    @ManyToMany(type => Promotion, promotion => promotion.channels, {
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
    })
    promotions: Promotion[];

    @ManyToMany(type => PaymentMethod, paymentMethod => paymentMethod.channels, {
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
    })
    paymentMethods: PaymentMethod[];

    @ManyToMany(type => ShippingMethod, shippingMethod => shippingMethod.channels, {
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
    })
    shippingMethods: ShippingMethod[];

    @ManyToMany(type => Customer, customer => customer.channels, {
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
    })
    customers: Customer[];

    @ManyToMany(type => StockLocation, stockLocation => stockLocation.channels, {
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
    })
    stockLocations: StockLocation[];

    @ManyToMany(type => ApiKey, apiKey => apiKey.channels, { onDelete: 'CASCADE' })
    apiKeys: ApiKey[];

    private generateToken(): string {
        const randomString = () => Math.random().toString(36).substr(3, 10);
        return `${randomString()}${randomString()}`;
    }
}
