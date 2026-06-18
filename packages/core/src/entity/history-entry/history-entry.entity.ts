import { HistoryEntryType } from '@vendure/common/lib/generated-types';
import { Column, Entity, Index, ManyToOne, TableInheritance } from 'typeorm';

import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { Administrator } from '../administrator/administrator.entity';
import { VendureEntity } from '../base/base.entity';
import { CustomHistoryEntryFields } from '../custom-entity-fields';

/**
 * @description
 * An abstract entity representing an entry in the history of an Order ({@link OrderHistoryEntry})
 * or a Customer ({@link CustomerHistoryEntry}).
 *
 * @docsCategory entities
 */
@Entity()
@TableInheritance({ column: { type: 'varchar', name: 'discriminator' } })
export abstract class HistoryEntry extends VendureEntity implements HasCustomFields {
    @Index()
    @ManyToOne(type => Administrator)
    administrator?: Administrator;

    @Column({ nullable: false, type: 'varchar' })
    readonly type: HistoryEntryType;

    @Column()
    isPublic: boolean;

    @Column('simple-json')
    data: any;

    @Column(type => CustomHistoryEntryFields)
    customFields: CustomHistoryEntryFields;
}
