import { DeepPartial } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index } from 'typeorm';

import { VendureEntity } from '../../entity/base/base.entity';

@Entity()
export class CacheItem extends VendureEntity {
    constructor(input: DeepPartial<CacheItem>) {
        super(input);
    }

    @Column({ precision: 3 })
    insertedAt: Date;

    @Index('cache_item_key')
    @Column({ unique: true })
    key: string;

    @Column('text')
    value: string;

    @Column({ nullable: true, precision: 3 })
    expiresAt?: Date;
}
