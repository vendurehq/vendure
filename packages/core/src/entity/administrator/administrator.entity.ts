import { DeepPartial } from '@vendure/common/lib/shared-types';
import { Column, Entity, JoinColumn, OneToOne, Unique } from 'typeorm';

import { SoftDeletable } from '../../common/types/common-types';
import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { VendureEntity } from '../base/base.entity';
import { CustomAdministratorFields } from '../custom-entity-fields';
import { User } from '../user/user.entity';

/**
 * @description
 * An administrative user who has access to the Admin UI and Admin API. The
 * specific permissions of the Administrator are determined by the assigned
 * {@link Role}s.
 *
 * @docsCategory entities
 */
@Entity()
@Unique(['emailAddress', 'isCurrent'])
export class Administrator extends VendureEntity implements SoftDeletable, HasCustomFields {
    constructor(input?: DeepPartial<Administrator>) {
        super(input);
    }

    @Column({ type: Date, nullable: true })
    deletedAt: Date | null;

    @Column() firstName: string;

    @Column() lastName: string;

    @Column()
    emailAddress: string;

    @Column({ type: 'boolean', default: true, nullable: true })
    isCurrent: true | null;

    @OneToOne(type => User)
    @JoinColumn()
    user: User;

    @Column(type => CustomAdministratorFields)
    customFields: CustomAdministratorFields;
}
