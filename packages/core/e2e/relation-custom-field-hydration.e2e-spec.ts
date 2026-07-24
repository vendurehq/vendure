import {
    Asset,
    DeepPartial,
    EntityHydrator,
    EntityId,
    ID,
    Injector,
    mergeConfig,
    Order,
    OrderInterceptor,
    OrderLine,
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

// A plugin-defined custom entity used as the target of an OrderLine relation custom field. It
// carries its own relation-id column (`@EntityId` alongside a `@ManyToOne`, mapping to the same
// database column as the join column), the same arrangement relation custom fields themselves use.
@Entity()
class RelatedThing extends VendureEntity {
    constructor(input?: DeepPartial<RelatedThing>) {
        super(input);
    }

    @Column()
    label: string;

    @ManyToOne(() => Asset)
    asset: Asset;

    @EntityId({ nullable: true })
    assetId: ID;
}

@VendurePlugin({
    entities: [RelatedThing],
    configuration: config => {
        config.customFields.OrderLine.push({
            name: 'thing',
            type: 'relation',
            entity: RelatedThing,
            nullable: true,
            internal: true,
        });
        return config;
    },
})
class TestPlugin {}

// An OrderInterceptor that hydrates the relation custom field on the OrderLine it is passed,
// as a plugin would to inspect the line before allowing the mutation.
class HydratingInterceptor implements OrderInterceptor {
    private entityHydrator: EntityHydrator;
    hydratedThing: unknown = 'NOT_CALLED';

    init(injector: Injector) {
        this.entityHydrator = injector.get(EntityHydrator);
    }

    async willRemoveItemFromOrder(
        ctx: RequestContext,
        order: Order,
        orderLine: OrderLine,
    ): Promise<void | string> {
        await this.entityHydrator.hydrate(ctx, orderLine, { relations: ['customFields.thing'] });
        this.hydratedThing = (orderLine.customFields as any).thing ?? null;
    }
}

describe('Relation custom field hydration', () => {
    const interceptor = new HydratingInterceptor();

    const { server, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            plugins: [TestPlugin],
            orderOptions: {
                orderInterceptors: [interceptor],
            },
        }),
    );

    let thingId: number;

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        const connection = server.app.get(TransactionalConnection).rawConnection;
        const asset = await connection.getRepository(Asset).findOneOrFail({ where: {} });
        const thing = await connection
            .getRepository(RelatedThing)
            .save(new RelatedThing({ label: 'test', asset }));
        thingId = thing.id as number;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    // The EntityHydrator must be able to resolve a relation custom field. Since #5012 gave
    // relation custom fields an id column co-mapped with the relation's join column, TypeORM's
    // 'query' relation load strategy can return null for such relations, so the hydrator loads
    // them with the 'join' strategy.
    it('resolves a relation custom field hydrated inside an OrderInterceptor', async () => {
        const { addItemToOrder } = await shopClient.query(gql`
            mutation {
                addItemToOrder(productVariantId: "T_1", quantity: 1) {
                    ... on Order {
                        id
                        lines {
                            id
                        }
                    }
                }
            }
        `);
        const lineId = addItemToOrder.lines[0].id;
        const internalLineId = +lineId.replace(/^\D+/g, '');

        // Persist the relation-id column directly (the field is internal).
        await server.app
            .get(TransactionalConnection)
            .rawConnection.query('update order_line set "customFieldsThingid" = $1 where id = $2', [
                thingId,
                internalLineId,
            ]);

        await shopClient.query(gql`
            mutation {
                removeOrderLine(orderLineId: "${lineId}") {
                    ... on Order {
                        id
                    }
                }
            }
        `);

        expect(interceptor.hydratedThing).not.toBe('NOT_CALLED');
        expect((interceptor.hydratedThing as any)?.id).toBe(thingId);
    });
});
