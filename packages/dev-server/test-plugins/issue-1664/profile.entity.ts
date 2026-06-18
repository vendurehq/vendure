import { DeepPartial } from '@vendure/common/lib/shared-types';
import { User, VendureEntity } from '@vendure/core';
import { Column, Entity, JoinColumn, ManyToOne, OneToMany, OneToOne } from 'typeorm';

import { ProfileAsset } from './profile-asset.entity';

@Entity()
export class Profile extends VendureEntity {
    constructor(input?: DeepPartial<Profile>) {
        super(input);
    }
    /**
     * The reference to a user
     */
    @ManyToOne(() => User, user => (user as any).profileId, { onDelete: 'CASCADE' })
    user: User;
    /**
     * Profile display name
     */
    @Column()
    name: string;
    /**
     * The profile picture
     */
    @OneToOne(() => ProfileAsset, profileAsset => profileAsset.profile, {
        onDelete: 'SET NULL',
        nullable: true,
    })
    @JoinColumn()
    featuredAsset: ProfileAsset;

    /**
     * Other assets
     */
    @OneToMany(() => ProfileAsset, profileAsset => profileAsset.profile, {
        onDelete: 'CASCADE',
    })
    assets: ProfileAsset[];
}
