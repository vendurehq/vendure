import { Permission } from '@vendure/common/lib/generated-types';
import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { VendureEntity } from '../base/base.entity';
import { Channel } from '../channel/channel.entity';
import { CustomRoleFields } from '../custom-entity-fields';
import { EntityId } from '../entity-id.decorator';

/**
 * @description
 * A Role represents a collection of permissions which determine the authorization
 * level of a {@link User}. The Channels on which a User holds a Role's permissions are
 * determined per-User by {@link RoleAssignment}s.
 *
 * Every Role is owned by a Channel, which decides who may edit it and where it may be
 * assigned:
 *
 * - A Role owned by the **default Channel** is a shared Role. It may be assigned on any
 *   Channel, so a single definition (e.g. "Order Fulfillment") serves every vendor of a
 *   multi-vendor marketplace. All Roles of a single-channel instance are shared Roles.
 * - A Role owned by **any other Channel** is private to that Channel. It may only be
 *   assigned on its owning Channel, and is invisible to administrators of other Channels.
 *
 * The owning Channel is set from the active Channel when the Role is created, and does
 * not change afterwards. Deleting a Channel deletes the Roles it owns.
 *
 * @docsCategory entities
 */
@Entity()
export class Role extends VendureEntity implements HasCustomFields {
    constructor(input?: DeepPartial<Role>) {
        super(input);
    }

    @Column() code: string;

    @Column() description: string;

    @Column('simple-array') permissions: Permission[];

    @Column(type => CustomRoleFields)
    customFields: CustomRoleFields;

    /**
     * @description
     * The Channel which owns this Role.
     *
     * @since 4.0.0
     */
    @Index()
    @ManyToOne(type => Channel, { onDelete: 'CASCADE' })
    channel: Channel;

    /**
     * @description
     * The id of the owning Channel. Nullable in the database only so that the v4 upgrade can
     * add the column to existing Roles and v3 servers can keep creating Roles during a rolling
     * deployment. The role assignment migration sets it on every Role, and a Role without an
     * owner can be granted by nobody.
     *
     * @since 4.0.0
     */
    @EntityId({ nullable: true })
    channelId: ID | null;
}
