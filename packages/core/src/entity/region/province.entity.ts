import { DeepPartial } from '@vendure/common/lib/shared-types';
import { ChildEntity } from 'typeorm';

import { Region, RegionType } from './region.entity';

/**
 * @description
 * A Province represents an administrative subdivision of a {@link Country}. For example, in the
 * United States, the country would be "United States" and the province would be "California".
 *
 * @docsCategory entities
 */
@ChildEntity()
export class Province extends Region {
    constructor(input?: DeepPartial<Province>) {
        super(input);
    }

    readonly type: RegionType = 'province';
}
