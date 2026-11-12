import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import {
    ChannelAssignmentService,
    ChannelService,
    ID,
    ListQueryBuilder,
    mergeConfig,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    TestChannelThing,
    TestChannelThingChannel,
    TestChannelThingPlugin,
    TestPlainChannelThing,
} from './fixtures/test-plugins/channel-assignment-test-plugin';

const CREATE_CHANNEL = gql`
    mutation CreateChannel($input: CreateChannelInput!) {
        createChannel(input: $input) {
            ... on Channel {
                id
            }
        }
    }
`;

/**
 * Every ChannelAware entity has a channel assignment entity which owns the junction table of its
 * `channels` relation (see `ChannelAssignment`).
 */
describe('Channel assignment entities', () => {
    const { server, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), { plugins: [TestChannelThingPlugin] }),
    );

    let ctx: RequestContext;
    let service: ChannelAssignmentService;
    let defaultChannelId: ID;
    let channelBId: ID;
    let things: TestChannelThing[];

    const dataSource = () => server.app.get(TransactionalConnection).rawConnection;
    // Every entity with an owning `channels` many-to-many relation, core and plugin, except the
    // plugin entity which deliberately has no assignment entity
    const channelAwareMetadatas = () =>
        dataSource().entityMetadatas.filter(m => {
            const relation = m.findRelationWithPropertyPath('channels');
            return relation?.isManyToMany && relation.isOwning && m.target !== TestPlainChannelThing;
        });
    const rows = (thingIds: ID[], channelId: ID) =>
        service.getAssignments<TestChannelThingChannel>(ctx, TestChannelThing, thingIds, channelId);

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        const { createChannel } = await adminClient.query(CREATE_CHANNEL, {
            input: {
                code: 'assignment-b',
                token: 'assignment-b-token',
                defaultLanguageCode: LanguageCode.en,
                currencyCode: CurrencyCode.USD,
                pricesIncludeTax: false,
                defaultShippingZoneId: 'T_1',
                defaultTaxZoneId: 'T_1',
            },
        });
        channelBId = createChannel.id.replace('T_', '');
        ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        defaultChannelId = ctx.channelId;
        service = server.app.get(ChannelAssignmentService);
        things = await dataSource()
            .getRepository(TestChannelThing)
            .save(
                ['a', 'b', 'c'].map(
                    name => new TestChannelThing({ name, channels: [{ id: defaultChannelId }] }),
                ),
            );
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    describe('metadata', () => {
        it('every ChannelAware entity has an assignment entity owning its unsynchronized junction', () => {
            const metadatas = channelAwareMetadatas();
            expect(metadatas.map(m => m.name)).toEqual(
                expect.arrayContaining(['Product', 'TestChannelThing']),
            );
            for (const metadata of metadatas) {
                const junction = metadata.findRelationWithPropertyPath('channels')?.junctionEntityMetadata;
                expect(junction?.synchronize, metadata.name).toBe(false);
                const meta = service.getMetadata(metadata.target as any);
                expect(meta && dataSource().getMetadata(meta.target).tableName, metadata.name).toBe(
                    junction?.tableName,
                );
            }
        });

        it('lists the per-channel data properties', () => {
            expect(service.getMetadata(TestChannelThing)?.dataProperties.sort()).toEqual(['flag', 'note']);
            expect(service.getMetadata(TestChannelThing)?.entityIdProperty).toBe('testChannelThingId');
        });

        it('the channels relation still reads and writes the junction table', async () => {
            const thing = await dataSource()
                .getRepository(TestChannelThing)
                .findOne({ where: { id: things[0].id }, relations: { channels: true } });
            expect(thing?.channels.map(c => c.id)).toEqual([defaultChannelId]);
            expect((await rows([things[0].id], defaultChannelId)).get(String(things[0].id))?.note).toBeNull();
        });
    });

    describe('reading and writing', () => {
        it('update() writes data properties of existing rows', async () => {
            await service.update<TestChannelThingChannel>(
                ctx,
                TestChannelThing,
                [things[0].id],
                [defaultChannelId],
                {
                    note: 'first',
                    flag: true,
                },
            );
            await service.update<TestChannelThingChannel>(
                ctx,
                TestChannelThing,
                [things[1].id],
                [defaultChannelId],
                {
                    note: 'second',
                },
            );
            const result = await rows([things[0].id, things[1].id], defaultChannelId);
            expect(result.get(String(things[0].id))).toMatchObject({ note: 'first', flag: true });
            expect(result.get(String(things[1].id))).toMatchObject({ note: 'second', flag: null });
        });

        it('update() rejects key columns and unknown properties', async () => {
            await expect(
                service.update(ctx, TestChannelThing, [things[0].id], [defaultChannelId], {
                    testChannelThingId: things[1].id,
                } as any),
            ).rejects.toThrow('Cannot write "testChannelThingId" on TestChannelThingChannel');
            await expect(
                service.update(ctx, TestChannelThing, [things[0].id], [defaultChannelId], { nope: 1 } as any),
            ).rejects.toThrow('Cannot write "nope"');
        });

        it('getAssignment() batches reads made in the same tick into one query', async () => {
            const freshCtx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
            const spy = vi.spyOn(service, 'getAssignments');
            const results = await Promise.all(
                things.map(t =>
                    service.getAssignment<TestChannelThingChannel>(freshCtx, TestChannelThing, t.id),
                ),
            );
            expect(spy).toHaveBeenCalledTimes(1);
            spy.mockRestore();
            expect(results.map(r => r?.note)).toEqual(['first', 'second', null]);
        });

        it('getAssignment() returns undefined for an entity not assigned to the Channel', async () => {
            const result = await service.getAssignment(ctx, TestChannelThing, things[0].id, channelBId);
            expect(result).toBeUndefined();
        });
    });

    describe('assigning to Channels', () => {
        it('copies the per-channel data from the active Channel to a new assignment', async () => {
            // Read in the same RequestContext before and after assigning: reads are not cached
            expect(
                await service.getAssignment(ctx, TestChannelThing, things[0].id, channelBId),
            ).toBeUndefined();
            await server.app
                .get(ChannelService)
                .assignToChannels(ctx, TestChannelThing, things[0].id, [channelBId]);
            expect(
                (
                    await service.getAssignment<TestChannelThingChannel>(
                        ctx,
                        TestChannelThing,
                        things[0].id,
                        channelBId,
                    )
                )?.note,
            ).toBe('first');
            expect((await rows([things[0].id], channelBId)).get(String(things[0].id))).toMatchObject({
                note: 'first',
                flag: true,
            });
        });

        it('applies explicit assignment data to new and existing assignments', async () => {
            const channelService = server.app.get(ChannelService);
            await channelService.assignToChannels(ctx, TestChannelThing, things[1].id, [channelBId], {
                note: 'set on assign',
            });
            expect((await rows([things[1].id], channelBId)).get(String(things[1].id))?.note).toBe(
                'set on assign',
            );
            // Already assigned to channel B: the data is still applied
            await channelService.assignToChannels(ctx, TestChannelThing, things[0].id, [channelBId], {
                note: 'updated on assign',
            });
            expect((await rows([things[0].id], channelBId)).get(String(things[0].id))?.note).toBe(
                'updated on assign',
            );
        });

        it('rejects assignment data which is not a per-channel property, before assigning', async () => {
            await expect(
                server.app
                    .get(ChannelService)
                    .assignToChannels(ctx, TestChannelThing, things[2].id, [channelBId], { channelId: 99 }),
            ).rejects.toThrow('Cannot write "channelId"');
            expect(
                await service.getAssignment(ctx, TestChannelThing, things[2].id, channelBId),
            ).toBeUndefined();
        });

        it('copies from an existing assignment when assigning to the active Channel itself', async () => {
            // Only in channel B, with a value there
            const [onlyInB] = await dataSource()
                .getRepository(TestChannelThing)
                .save([new TestChannelThing({ name: 'd', channels: [{ id: channelBId }] })]);
            await service.update<TestChannelThingChannel>(ctx, TestChannelThing, [onlyInB.id], [channelBId], {
                note: 'from b',
            });
            await server.app
                .get(ChannelService)
                .assignToChannels(ctx, TestChannelThing, onlyInB.id, [ctx.channelId]);
            expect(
                (await service.getAssignment<TestChannelThingChannel>(ctx, TestChannelThing, onlyInB.id))
                    ?.note,
            ).toBe('from b');
            await dataSource().getRepository(TestChannelThing).delete(onlyInB.id);
        });

        it('getAssignmentsByChannel() returns the rows of every Channel', async () => {
            const result = await service.getAssignmentsByChannel<TestChannelThingChannel>(
                ctx,
                TestChannelThing,
                [things[0].id],
            );
            const byChannel = result.get(String(things[0].id));
            expect(byChannel?.get(String(defaultChannelId))?.note).toBe('first');
            expect(byChannel?.get(String(channelBId))?.note).toBe('updated on assign');
        });
    });

    describe('ListQueryBuilder', () => {
        const list = async (channelId: ID, options: any) => {
            const [items] = await server.app
                .get(ListQueryBuilder)
                .build(TestChannelThing, options, { channelId, ctx })
                .getManyAndCount();
            return items.map(i => i.name);
        };

        it('filters on a per-channel column of the given Channel', async () => {
            expect(await list(defaultChannelId, { filter: { note: { eq: 'first' } } })).toEqual(['a']);
            expect(await list(channelBId, { filter: { note: { eq: 'first' } } })).toEqual([]);
            expect(await list(channelBId, { filter: { note: { eq: 'updated on assign' } } })).toEqual(['a']);
        });

        it('exposes a column that clashes with an entity column as <name>InChannel', async () => {
            expect(await list(defaultChannelId, { filter: { flagInChannel: { eq: true } } })).toEqual(['a']);
            // `flag` is still the entity's own column
            expect(await list(defaultChannelId, { filter: { flag: { eq: false } } })).toEqual([
                'a',
                'b',
                'c',
            ]);
        });

        it('sorts on a per-channel column, with pagination', async () => {
            // NULLs are excluded, as databases order them differently
            expect(
                await list(defaultChannelId, {
                    filter: { note: { isNull: false } },
                    sort: { note: 'DESC' },
                    take: 2,
                }),
            ).toEqual(['b', 'a']);
        });

        // Channel scoping and per-channel filters and sorts share one join on the assignment row,
        // rather than joining the junction table once for each
        it('scopes to the Channel with a single join on the assignment table', async () => {
            const tableName = dataSource().getMetadata(TestChannelThingChannel).tableName;
            const joinCount = (options: any) =>
                server.app
                    .get(ListQueryBuilder)
                    .build(TestChannelThing, options, { channelId: channelBId, ctx })
                    .getQuery()
                    .split(tableName).length - 1;
            expect(joinCount({})).toBe(1);
            expect(joinCount({ filter: { note: { isNull: false }, flagInChannel: { eq: true } } })).toBe(1);
            expect(joinCount({ sort: { note: 'ASC' } })).toBe(1);
        });

        it('returns the items and count of the given Channel, with and without per-channel filters', async () => {
            const listAndCount = async (channelId: ID, options: any) => {
                const [items, totalItems] = await server.app
                    .get(ListQueryBuilder)
                    .build(TestChannelThing, options, { channelId, ctx })
                    .getManyAndCount();
                return { names: items.map(i => i.name).sort(), totalItems };
            };
            expect(await listAndCount(defaultChannelId, {})).toEqual({
                names: ['a', 'b', 'c'],
                totalItems: 3,
            });
            expect(await listAndCount(channelBId, {})).toEqual({ names: ['a', 'b'], totalItems: 2 });
            expect(await listAndCount(channelBId, { take: 1 })).toEqual({
                names: [expect.any(String)],
                totalItems: 2,
            });
            expect(await listAndCount(channelBId, { filter: { note: { eq: 'set on assign' } } })).toEqual({
                names: ['b'],
                totalItems: 1,
            });
        });

        it('loadChannelAssignment loads the row of the Channel, which getAssignment() reuses', async () => {
            const [items] = await server.app
                .get(ListQueryBuilder)
                .build(
                    TestChannelThing,
                    { sort: { name: 'ASC' }, take: 2 },
                    { channelId: channelBId, ctx, loadChannelAssignment: true },
                )
                .getManyAndCount();
            expect(items.map(i => i.name)).toEqual(['a', 'b']);
            const spy = vi.spyOn(service, 'getAssignments');
            const inB = await Promise.all(
                items.map(i =>
                    service.getAssignment<TestChannelThingChannel>(ctx, TestChannelThing, i, channelBId),
                ),
            );
            expect(inB.map(r => r?.note)).toEqual(['updated on assign', 'set on assign']);
            expect(spy).not.toHaveBeenCalled();
            // The row of another Channel is still read from the database
            const inDefault = await service.getAssignment<TestChannelThingChannel>(
                ctx,
                TestChannelThing,
                items[0],
                defaultChannelId,
            );
            expect(inDefault?.note).toBe('first');
            expect(spy).toHaveBeenCalledTimes(1);
            spy.mockRestore();
        });

        it('scopes an entity without an assignment entity via its channels relation', async () => {
            const plain = await dataSource()
                .getRepository(TestPlainChannelThing)
                .save([
                    new TestPlainChannelThing({ name: 'p1', channels: [{ id: defaultChannelId }] }),
                    new TestPlainChannelThing({
                        name: 'p2',
                        channels: [{ id: defaultChannelId }, { id: channelBId }],
                    }),
                ]);
            const listPlain = async (channelId: ID) => {
                const [items, totalItems] = await server.app
                    .get(ListQueryBuilder)
                    .build(TestPlainChannelThing, { sort: { name: 'ASC' } }, { channelId, ctx })
                    .getManyAndCount();
                return { names: items.map(i => i.name), totalItems };
            };
            expect(await listPlain(defaultChannelId)).toEqual({ names: ['p1', 'p2'], totalItems: 2 });
            expect(await listPlain(channelBId)).toEqual({ names: ['p2'], totalItems: 1 });
            await dataSource().getRepository(TestPlainChannelThing).remove(plain);
        });
    });

    describe('schema synchronization', () => {
        it('finds no difference between the entities and the database', async () => {
            const { upQueries } = await dataSource().driver.createSchemaBuilder().log();
            expect(upQueries.map(q => q.query)).toEqual([]);
        });

        it('keeps every junction row and per-channel value', async () => {
            const count = async () => {
                const result: Record<string, number> = {};
                for (const metadata of channelAwareMetadatas()) {
                    const meta = service.getMetadata(metadata.target as any);
                    if (meta) {
                        result[metadata.name] = await dataSource().getRepository(meta.target).count();
                    }
                }
                return result;
            };
            const before = await count();
            const valuesBefore = await rows(
                things.map(t => t.id),
                defaultChannelId,
            );
            await dataSource().synchronize();
            await dataSource().synchronize();
            expect(await count()).toEqual(before);
            expect(
                await rows(
                    things.map(t => t.id),
                    defaultChannelId,
                ),
            ).toEqual(valuesBefore);
        });
    });
});
