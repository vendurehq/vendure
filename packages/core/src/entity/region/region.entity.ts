import { ID } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, TableInheritance } from 'typeorm';

import { LocaleString, Translatable, Translation } from '../../common/types/locale-types';
import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { VendureEntity } from '../base/base.entity';
import { CustomRegionFields } from '../custom-entity-fields';
import { EntityId } from '../entity-id.decorator';

import { RegionTranslation } from './region-translation.entity';

export type RegionType = 'country' | 'province' | string;

/**
 * @description
 * A Region represents a geographical administrative unit, such as a Country, Province, State, Prefecture etc.
 * This is an abstract class which is extended by the {@link Country} and {@link Province} entities.
 * Regions can be grouped into {@link Zone}s which are in turn used to determine applicable shipping and taxes for an {@link Order}.
 *
 * @docsCategory entities
 */
@Entity()
@TableInheritance({ column: { type: 'varchar', name: 'discriminator' } })
export abstract class Region extends VendureEntity implements Translatable, HasCustomFields {
    /**
     * @description
     * A code representing the region. The code format will depend on the type of region. For
     * example, a Country code will be a 2-letter ISO code, whereas a Province code could use
     * a format relevant to the type of province, e.g. a US state code like "CA".
     */
    @Column() code: string;

    @Column({ nullable: false, type: 'varchar' })
    readonly type: RegionType;

    name: LocaleString;

    @Index()
    @ManyToOne(type => Region, { nullable: true, onDelete: 'SET NULL' })
    parent?: Region;

    @EntityId({ nullable: true })
    parentId?: ID;

    @Column() enabled: boolean;

    @OneToMany(type => RegionTranslation, translation => translation.base, { eager: true })
    translations: Array<Translation<Region>>;

    @Column(type => CustomRegionFields)
    customFields: CustomRegionFields;
}
