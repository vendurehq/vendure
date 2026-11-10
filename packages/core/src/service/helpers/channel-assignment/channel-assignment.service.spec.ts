import {
    Column,
    DataSource,
    Entity,
    JoinTable,
    ManyToMany,
    PrimaryColumn,
    PrimaryGeneratedColumn,
} from 'typeorm';
import { describe, expect, it } from 'vitest';

import { validateChannelAssignmentMetadata } from './channel-assignment.service';

@Entity('channel')
class TestChannel {
    @PrimaryGeneratedColumn() id: number;
}

// A ChannelAware entity whose junction is not synchronized, with a matching assignment entity
@Entity('thing')
class Thing {
    @PrimaryGeneratedColumn() id: number;
    @ManyToMany(() => TestChannel)
    @JoinTable({ synchronize: false })
    channels: TestChannel[];
}
@Entity('thing_channels_channel')
class ThingChannel {
    @PrimaryColumn() thingId: number;
    @PrimaryColumn() channelId: number;
    @Column({ nullable: true }) flag: boolean;
}

// An assignment entity on a junction which TypeORM still synchronizes
@Entity('synced_thing')
class SyncedThing {
    @PrimaryGeneratedColumn() id: number;
    @ManyToMany(() => TestChannel)
    @JoinTable()
    channels: TestChannel[];
}
@Entity('synced_thing_channels_channel')
class SyncedThingChannel {
    @PrimaryColumn() syncedThingId: number;
    @PrimaryColumn() channelId: number;
    @Column({ nullable: true }) flag: boolean;
}

// A junction which is not synchronized, with no assignment entity
@Entity('orphan_thing')
class OrphanThing {
    @PrimaryGeneratedColumn() id: number;
    @ManyToMany(() => TestChannel)
    @JoinTable({ synchronize: false })
    channels: TestChannel[];
}

// An assignment entity whose key columns don't match the junction (e.g. another naming strategy)
@Entity('mismatched_thing')
class MismatchedThing {
    @PrimaryGeneratedColumn() id: number;
    @ManyToMany(() => TestChannel)
    @JoinTable({ synchronize: false })
    channels: TestChannel[];
}
@Entity('mismatched_thing_channels_channel')
class MismatchedThingChannel {
    @PrimaryColumn() mismatched_thing_id: number;
    @PrimaryColumn() channelId: number;
}

async function metadataFor(entities: Array<new () => any>) {
    const dataSource = new DataSource({ type: 'sqljs', entities: [TestChannel, ...entities] });
    await dataSource.initialize();
    const { entityMetadatas } = dataSource;
    await dataSource.destroy();
    return entityMetadatas;
}

describe('validateChannelAssignmentMetadata()', () => {
    it('accepts an unsynchronized junction owned by a matching assignment entity', async () => {
        const metadatas = await metadataFor([Thing, ThingChannel]);
        expect(() => validateChannelAssignmentMetadata(metadatas)).not.toThrow();
    });

    it('accepts a ChannelAware entity without an assignment entity, on a synchronized junction', async () => {
        const metadatas = await metadataFor([SyncedThing]);
        expect(() => validateChannelAssignmentMetadata(metadatas)).not.toThrow();
    });

    it('rejects an assignment entity on a junction which TypeORM synchronizes', async () => {
        const metadatas = await metadataFor([SyncedThing, SyncedThingChannel]);
        expect(() => validateChannelAssignmentMetadata(metadatas)).toThrow(
            /SyncedThingChannel is a channel assignment entity .* must use `@JoinTable\(\{ synchronize: false \}\)`/,
        );
    });

    it('rejects an unsynchronized junction without an assignment entity', async () => {
        const metadatas = await metadataFor([OrphanThing]);
        expect(() => validateChannelAssignmentMetadata(metadatas)).toThrow(
            /"orphan_thing_channels_channel" of OrphanThing must be owned by a channel assignment entity/,
        );
    });

    it('rejects an assignment entity whose key columns do not match the junction', async () => {
        const metadatas = await metadataFor([MismatchedThing, MismatchedThingChannel]);
        expect(() => validateChannelAssignmentMetadata(metadatas)).toThrow(
            /found channelId, mismatched_thing_id/,
        );
    });
});
