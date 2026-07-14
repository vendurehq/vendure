import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index, ManyToMany, ManyToOne } from 'typeorm';

import { Customer, PaymentMethod, Promotion, Role, ShippingMethod, StockLocation } from '..';
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
     * Specifies the default value for inventory tracking for ProductVariants.
     * Can be overridden per ProductVariant, but this value determines the default
     * if not otherwise specified.
     */
    @Column({ default: true })
    trackInventory: boolean;

    /**
     * @description
     * Specifies the value of stockOnHand at which a given ProductVariant is considered
     * out of stock.
     */
    @Column({ default: 0 })
    outOfStockThreshold: number;

    @Column(type => CustomChannelFields)
    customFields: CustomChannelFields;

    @Column() pricesIncludeTax: boolean;

    @ManyToMany(type => Product, product => product.channels, { onDelete: 'CASCADE' })
    products: Product[];

    @ManyToMany(type => ProductVariant, productVariant => productVariant.channels, { onDelete: 'CASCADE' })
    productVariants: ProductVariant[];

    @ManyToMany(type => FacetValue, facetValue => facetValue.channels, { onDelete: 'CASCADE' })
    facetValues: FacetValue[];

    @ManyToMany(type => Facet, facet => facet.channels, { onDelete: 'CASCADE' })
    facets: Facet[];

    @ManyToMany(type => ProductOptionGroup, pog => pog.channels, { onDelete: 'CASCADE' })
    productOptionGroups: ProductOptionGroup[];

    @ManyToMany(type => ProductOption, po => po.channels, { onDelete: 'CASCADE' })
    productOptions: ProductOption[];

    @ManyToMany(type => Collection, collection => collection.channels, { onDelete: 'CASCADE' })
    collections: Collection[];

    @ManyToMany(type => Promotion, promotion => promotion.channels, { onDelete: 'CASCADE' })
    promotions: Promotion[];

    @ManyToMany(type => PaymentMethod, paymentMethod => paymentMethod.channels, { onDelete: 'CASCADE' })
    paymentMethods: PaymentMethod[];

    @ManyToMany(type => ShippingMethod, shippingMethod => shippingMethod.channels, { onDelete: 'CASCADE' })
    shippingMethods: ShippingMethod[];

    @ManyToMany(type => Customer, customer => customer.channels, { onDelete: 'CASCADE' })
    customers: Customer[];

    @ManyToMany(type => Role, role => role.channels, { onDelete: 'CASCADE' })
    roles: Role[];

    @ManyToMany(type => StockLocation, stockLocation => stockLocation.channels, { onDelete: 'CASCADE' })
    stockLocations: StockLocation[];

    @ManyToMany(type => ApiKey, apiKey => apiKey.channels, { onDelete: 'CASCADE' })
    apiKeys: ApiKey[];

    private generateToken(): string {
        const randomString = () => Math.random().toString(36).substr(3, 10);
        return `${randomString()}${randomString()}`;
    }
}
