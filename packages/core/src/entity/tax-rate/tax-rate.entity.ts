import { TaxLine } from '@vendure/common/lib/generated-types';
import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

import { grossPriceOf, netPriceOf, taxComponentOf, taxPayableOn } from '../../common/tax-utils';
import { idsAreEqual } from '../../common/utils';
import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { VendureEntity } from '../base/base.entity';
import { CustomTaxRateFields } from '../custom-entity-fields';
import { CustomerGroup } from '../customer-group/customer-group.entity';
import { EntityId } from '../entity-id.decorator';
import { TaxCategory } from '../tax-category/tax-category.entity';
import { DecimalTransformer } from '../value-transformers';
import { Zone } from '../zone/zone.entity';

/**
 * @description
 * A TaxRate defines the rate of tax to apply to a {@link ProductVariant} based on three factors:
 *
 * 1. the ProductVariant's {@link TaxCategory}
 * 2. the applicable {@link Zone} ("applicable" being defined by the configured {@link TaxZoneStrategy})
 * 3. the {@link CustomerGroup} of the current Customer
 *
 * @docsCategory entities
 */
@Entity()
export class TaxRate extends VendureEntity implements HasCustomFields {
    constructor(input?: DeepPartial<TaxRate>) {
        super(input);
    }

    @Column() name: string;

    @Column() enabled: boolean;

    @Column({ type: 'decimal', precision: 5, scale: 2, transformer: new DecimalTransformer() }) value: number;

    @Index()
    @ManyToOne(type => TaxCategory, taxCategory => taxCategory.taxRates)
    category: TaxCategory;

    @EntityId({ nullable: true })
    categoryId: ID;

    @Index()
    @ManyToOne(type => Zone, zone => zone.taxRates)
    zone: Zone;

    @EntityId({ nullable: true })
    zoneId: ID;

    @Index()
    @ManyToOne(type => CustomerGroup, customerGroup => customerGroup.taxRates, { nullable: true })
    customerGroup?: CustomerGroup;

    @Column(type => CustomTaxRateFields)
    customFields: CustomTaxRateFields;

    /**
     * Returns the tax component of a given gross price.
     */
    taxComponentOf(grossPrice: number): number {
        return taxComponentOf(grossPrice, this.value);
    }

    /**
     * Given a gross (tax-inclusive) price, returns the net price.
     */
    netPriceOf(grossPrice: number): number {
        return netPriceOf(grossPrice, this.value);
    }

    /**
     * Returns the tax applicable to the given net price.
     */
    taxPayableOn(netPrice: number): number {
        return taxPayableOn(netPrice, this.value);
    }

    /**
     * Given a net price, return the gross price (net + tax)
     */
    grossPriceOf(netPrice: number): number {
        return grossPriceOf(netPrice, this.value);
    }

    apply(price: number): TaxLine {
        return {
            description: this.name,
            taxRate: this.value,
        };
    }

    test(zone: Zone | ID, taxCategory: TaxCategory | ID): boolean {
        const taxCategoryId = this.isId(taxCategory) ? taxCategory : taxCategory.id;
        const zoneId = this.isId(zone) ? zone : zone.id;
        return idsAreEqual(taxCategoryId, this.categoryId) && idsAreEqual(zoneId, this.zoneId);
    }

    private isId<T>(entityOrId: T | ID): entityOrId is ID {
        return typeof entityOrId === 'string' || typeof entityOrId === 'number';
    }
}
