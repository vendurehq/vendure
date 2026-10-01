import { Permission } from '@vendure/common/lib/generated-types';
import { DeepPartial } from '@vendure/common/lib/shared-types';
import { Column, Entity } from 'typeorm';

import { VendureEntity } from '../base/base.entity';

/**
 * @description
 * A Role represents a collection of permissions which determine the authorization
 * level of a {@link User}. A Role is a channel-agnostic template: the Channels on
 * which its permissions apply are determined per-User by {@link RoleAssignment}s.
 *
 * @docsCategory entities
 */
@Entity()
export class Role extends VendureEntity {
    constructor(input?: DeepPartial<Role>) {
        super(input);
    }

    @Column() code: string;

    @Column() description: string;

    @Column('simple-array') permissions: Permission[];
}
