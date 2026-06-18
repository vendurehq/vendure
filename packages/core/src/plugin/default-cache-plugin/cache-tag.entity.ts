import { DeepPartial } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index, ManyToOne, RelationId, Unique } from 'typeorm';

import { VendureEntity } from '../../entity/base/base.entity';
import { EntityId } from '../../entity/index';

import { CacheItem } from './cache-item.entity';

@Entity()
@Unique(['tag', 'itemId'])
export class CacheTag extends VendureEntity {
    constructor(input: DeepPartial<CacheTag>) {
        super(input);
    }

    @Index('cache_tag_tag')
    @Column()
    tag: string;

    @ManyToOne(() => CacheItem, { onDelete: 'CASCADE' })
    item: CacheItem;

    @EntityId()
    itemId: string;
}
