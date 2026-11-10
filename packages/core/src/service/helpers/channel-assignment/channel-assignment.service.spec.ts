import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    Column,
    DataSource,
    Entity,
    JoinTable,
    ManyToMany,
    ManyToOne,
    MigrationInterface,
    PrimaryColumn,
    PrimaryGeneratedColumn,
    QueryRunner,
} from 'typeorm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { initializeDataSource } from '../../../connection/initialize-data-source';
import { ChannelAssignmentEntityOptions } from '../../../entity/channel-assignment/channel-assignment-registry';

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

// An assignment entity declaring a relation outside of its custom fields
@Entity('related_thing')
class RelatedThing {
    @PrimaryGeneratedColumn() id: number;
    @ManyToMany(() => TestChannel)
    @JoinTable({ synchronize: false })
    channels: TestChannel[];
}
@Entity('related_thing_channels_channel')
class RelatedThingChannel {
    @PrimaryColumn() relatedThingId: number;
    @PrimaryColumn() channelId: number;
    @ManyToOne(() => TestChannel) featuredChannel: TestChannel;
}

const registryEntry = (entity: () => any, entityProperty: string, tableName: string) =>
    ({ entity, entityProperty, tableName }) as ChannelAssignmentEntityOptions;

const registry = new Map<any, ChannelAssignmentEntityOptions>([
    [ThingChannel, registryEntry(() => Thing, 'thing', 'thing_channels_channel')],
    [SyncedThingChannel, registryEntry(() => SyncedThing, 'syncedThing', 'synced_thing_channels_channel')],
    [
        MismatchedThingChannel,
        registryEntry(() => MismatchedThing, 'mismatchedThing', 'mismatched_thing_channels_channel'),
    ],
    [
        RelatedThingChannel,
        registryEntry(() => RelatedThing, 'relatedThing', 'related_thing_channels_channel'),
    ],
]);

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
        expect(() => validateChannelAssignmentMetadata(metadatas, registry)).not.toThrow();
    });

    it('accepts a ChannelAware entity without an assignment entity, on a synchronized junction', async () => {
        const metadatas = await metadataFor([SyncedThing]);
        expect(() => validateChannelAssignmentMetadata(metadatas, registry)).not.toThrow();
    });

    it('rejects an assignment entity on a junction which TypeORM synchronizes', async () => {
        const metadatas = await metadataFor([SyncedThing, SyncedThingChannel]);
        expect(() => validateChannelAssignmentMetadata(metadatas, registry)).toThrow(
            /SyncedThingChannel maps the "synced_thing_channels_channel" table, so .* must use `@JoinTable\(\{ synchronize: false \}\)`/,
        );
    });

    it('rejects an unregistered entity on a junction which TypeORM synchronizes', async () => {
        const metadatas = await metadataFor([SyncedThing, SyncedThingChannel]);
        expect(() => validateChannelAssignmentMetadata(metadatas, new Map())).toThrow(
            /SyncedThingChannel maps the "synced_thing_channels_channel" table/,
        );
    });

    it('rejects an unsynchronized junction without an assignment entity', async () => {
        const metadatas = await metadataFor([OrphanThing]);
        expect(() => validateChannelAssignmentMetadata(metadatas, registry)).toThrow(
            /"orphan_thing_channels_channel" of OrphanThing must be owned by a channel assignment entity/,
        );
    });

    it('rejects an assignment entity whose key columns do not match the junction', async () => {
        const metadatas = await metadataFor([MismatchedThing, MismatchedThingChannel]);
        expect(() => validateChannelAssignmentMetadata(metadatas, registry)).toThrow(
            /found "mismatched_thing_channels_channel" with channelId, mismatched_thing_id/,
        );
    });

    it('rejects a relation declared directly on an assignment entity', async () => {
        const metadatas = await metadataFor([RelatedThing, RelatedThingChannel]);
        expect(() => validateChannelAssignmentMetadata(metadatas, registry)).toThrow(
            /RelatedThingChannel declares the relation\(s\) "featuredChannel"/,
        );
    });
});

@Entity('renamed_thing')
class RenamedThing {
    @PrimaryGeneratedColumn() id: number;
    @Column() newName: string;
}

class RenameColumnMigration1700000000000 implements MigrationInterface {
    async up(queryRunner: QueryRunner) {
        await queryRunner.query('ALTER TABLE "renamed_thing" RENAME COLUMN "oldName" TO "newName"');
    }
    async down() {
        /* not needed */
    }
}

class FailingMigration1700000000001 implements MigrationInterface {
    async up() {
        throw new Error('migration failed');
    }
    async down() {
        /* not needed */
    }
}

describe('initializeDataSource()', () => {
    const dbFile = path.join(os.tmpdir(), `vendure-init-ds-${process.pid}.sqlite`);
    afterEach(() => fs.rmSync(dbFile, { force: true }));

    async function createRenamedThingTable() {
        const setup = await new DataSource({ type: 'better-sqlite3', database: dbFile }).initialize();
        await setup.query(
            'CREATE TABLE "renamed_thing" ("id" integer PRIMARY KEY, "oldName" varchar NOT NULL)',
        );
        await setup.query(`INSERT INTO "renamed_thing" VALUES (1, 'kept')`);
        await setup.destroy();
    }

    it('runs migrations before schema synchronization, as TypeORM does', async () => {
        await createRenamedThingTable();
        const dataSource = await initializeDataSource({
            type: 'better-sqlite3',
            database: dbFile,
            entities: [RenamedThing],
            migrations: [RenameColumnMigration1700000000000],
            migrationsRun: true,
            synchronize: true,
        });
        expect(await dataSource.query('SELECT "newName" FROM "renamed_thing"')).toEqual([
            { newName: 'kept' },
        ]);
        expect(dataSource.options.synchronize).toBe(true);
        expect(dataSource.options.migrationsRun).toBe(true);
        await dataSource.destroy();
    });

    it('destroys the DataSource when a migration fails', async () => {
        await createRenamedThingTable();
        const destroy = vi.spyOn(DataSource.prototype, 'destroy');
        await expect(
            initializeDataSource({
                type: 'better-sqlite3',
                database: dbFile,
                entities: [RenamedThing],
                migrations: [FailingMigration1700000000001],
                migrationsRun: true,
            }),
        ).rejects.toThrow('migration failed');
        expect(destroy).toHaveBeenCalledTimes(1);
        expect(destroy.mock.contexts[0]).toMatchObject({ isInitialized: false });
        destroy.mockRestore();
    });
});
