import { DeepPartial } from '@vendure/common/lib/shared-types';
import { ChildEntity } from 'typeorm';

import { Region, RegionType } from './region.entity';

/**
 * @description
 * A country to which is available when creating / updating an {@link Address}. Countries are
 * grouped together into {@link Zone}s which are in turn used to determine applicable shipping
 * and taxes for an {@link Order}.
 *
 * @docsCategory entities
 */
@ChildEntity()
export class Country extends Region {
    constructor(input?: DeepPartial<Country>) {
        super(input);
    }

    readonly type: RegionType = 'country';
}
