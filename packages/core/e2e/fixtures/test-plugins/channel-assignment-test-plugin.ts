import {
    Channel,
    ChannelAssignment,
    ChannelAssignmentEntity,
    ChannelAware,
    DeepPartial,
    ID,
    PluginCommonModule,
    VendureEntity,
    VendurePlugin,
} from '@vendure/core';
import { Column, Entity, JoinTable, ManyToMany } from 'typeorm';

/**
 * A ChannelAware entity of a plugin, with a channel assignment entity holding two per-channel
 * columns: `note`, and `flag` which clashes with the entity's own `flag` column.
 */
@Entity()
export class TestChannelThing extends VendureEntity implements ChannelAware {
    constructor(input?: DeepPartial<TestChannelThing>) {
        super(input);
    }

    @Column() name: string;

    @Column({ default: false }) flag: boolean;

    @ManyToMany(() => Channel)
    @JoinTable({ synchronize: false })
    channels: Channel[];
}

@ChannelAssignmentEntity({
    entity: () => TestChannelThing,
    entityProperty: 'testChannelThing',
    tableName: 'test_channel_thing_channels_channel',
    channelOnUpdate: 'CASCADE',
})
export class TestChannelThingChannel extends ChannelAssignment {
    testChannelThingId: ID;
    testChannelThing: TestChannelThing;

    @Column({ type: String, nullable: true, default: null }) note: string | null;

    @Column({ type: Boolean, nullable: true, default: null }) flag: boolean | null;
}

/**
 * A ChannelAware entity of a plugin without a channel assignment entity: TypeORM manages the
 * junction table of its `channels` relation.
 */
@Entity()
export class TestPlainChannelThing extends VendureEntity implements ChannelAware {
    constructor(input?: DeepPartial<TestPlainChannelThing>) {
        super(input);
    }

    @Column() name: string;

    @ManyToMany(() => Channel)
    @JoinTable()
    channels: Channel[];
}

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [TestChannelThing, TestChannelThingChannel, TestPlainChannelThing],
})
export class TestChannelThingPlugin {}
