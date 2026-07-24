import { Args, Query, Resolver } from '@nestjs/graphql';
import {
    Asset,
    Ctx,
    DeepPartial,
    EntityHydrator,
    EntityId,
    ID,
    mergeConfig,
    PluginCommonModule,
    Product,
    RequestContext,
    TransactionalConnection,
    VendureEntity,
    VendurePlugin,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { Column, Entity, ManyToOne } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

// Regression test for relation custom field hydration (relates to #5012, fixed in #5030).
//
// Since #5012, every relation custom field maps an id column onto the same database column as
// the relation's join column. This activates an in-memory fast path in TypeORM's
// `relationLoadStrategy: 'query'` implementation (used by the EntityHydrator) which builds its
// result keys of the form `<TargetEntity>_customFields_<fieldName>_id` by plain string
// concatenation, while the consuming code hashes any key longer than the driver's max alias
// length (63 chars on postgres and mysql). When the key exceeds that limit the lookup misses and
// the relation silently hydrates as `null`. See `typeorm-relation-id-loader-fix.ts`.
//
// The entity and field names below are chosen to place one lookup key on each side of the limit:
//   TestProductConfigurationLine_customFields_testProductConfigurationLine_id  (73 chars, broken)
//   TestProductConfigurationLine_customFields_shortRelation_id                 (58 chars, always worked)
// SQLite imposes no alias length limit, so only the postgres and mysql runs exercise the bug.
@Entity()
class TestProductConfigurationLine extends VendureEntity {
    constructor(input?: DeepPartial<TestProductConfigurationLine>) {
        super(input);
    }

    @Column()
    label: string;

    @ManyToOne(() => Asset)
    asset: Asset;

    @EntityId({ nullable: true })
    assetId: ID;
}

@Resolver()
class TestResolver {
    constructor(
        private connection: TransactionalConnection,
        private entityHydrator: EntityHydrator,
    ) {}

    @Query()
    async hydrateProductRelationCustomFields(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        const product = await this.connection
            .getRepository(ctx, Product)
            .findOneOrFail({ where: { id: args.id } });
        await this.entityHydrator.hydrate(ctx, product, {
            relations: ['customFields.testProductConfigurationLine.asset', 'customFields.shortRelation'],
        });
        const customFields = product.customFields as any;
        return JSON.stringify({
            longField: customFields.testProductConfigurationLine
                ? {
                      id: customFields.testProductConfigurationLine.id,
                      assetId: customFields.testProductConfigurationLine.asset?.id ?? null,
                  }
                : null,
            shortField: customFields.shortRelation ? { id: customFields.shortRelation.id } : null,
        });
    }
}

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [TestProductConfigurationLine],
    adminApiExtensions: {
        schema: gql`
            extend type Query {
                hydrateProductRelationCustomFields(id: ID!): String!
            }
        `,
        resolvers: [TestResolver],
    },
    configuration: config => {
        config.customFields.Product.push(
            {
                name: 'testProductConfigurationLine',
                type: 'relation',
                entity: TestProductConfigurationLine,
                nullable: true,
                internal: true,
            },
            {
                name: 'shortRelation',
                type: 'relation',
                entity: TestProductConfigurationLine,
                nullable: true,
                internal: true,
            },
        );
        return config;
    },
})
class TestPlugin {}

describe('Relation custom field hydration', () => {
    const { server, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            plugins: [TestPlugin],
        }),
    );

    let lineId: number;
    let assetId: number;

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        const connection = server.app.get(TransactionalConnection).rawConnection;
        const asset = await connection.getRepository(Asset).findOneOrFail({ where: {} });
        assetId = asset.id as number;
        const line = await connection
            .getRepository(TestProductConfigurationLine)
            .save(new TestProductConfigurationLine({ label: 'test line', asset }));
        lineId = line.id as number;
        await connection.getRepository(Product).update(1, {
            customFields: {
                testProductConfigurationLineId: lineId,
                shortRelationId: lineId,
            } as any,
        });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('hydrates relation custom fields regardless of name length', async () => {
        const { hydrateProductRelationCustomFields } = await adminClient.query(gql`
            query {
                hydrateProductRelationCustomFields(id: "T_1")
            }
        `);
        const result = JSON.parse(hydrateProductRelationCustomFields);
        expect(result.shortField).toEqual({ id: lineId });
        expect(result.longField).toEqual({ id: lineId, assetId });
    });
});
