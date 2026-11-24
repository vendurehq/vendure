/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { Args, Info, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import {
    Ctx,
    ID,
    IdArgumentDecoder,
    mergeConfig,
    PluginCommonModule,
    Product,
    ProductVariant,
    RequestContext,
    TransactionalConnection,
    VendurePlugin,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import { GraphQLResolveInfo } from 'graphql';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { graphql } from './graphql/graphql-admin';
import { addItemToOrderDocument } from './graphql/shop-definitions';
import { awaitRunningJobs } from './utils/await-running-jobs';

@Resolver('Product')
class ProductHasVariantResolver {
    constructor(
        private idArgumentDecoder: IdArgumentDecoder,
        private connection: TransactionalConnection,
    ) {}

    @ResolveField()
    async hasVariant(
        @Ctx() ctx: RequestContext,
        @Parent() product: Product,
        @Args() args: { variantId: ID },
        @Info() info: GraphQLResolveInfo,
    ): Promise<boolean> {
        const { variantId } = this.idArgumentDecoder.decode(info, args);
        const count = await this.connection
            .getRepository(ctx, ProductVariant)
            .count({ where: { id: variantId, productId: product.id } });
        return 0 < count;
    }
}

@VendurePlugin({
    imports: [PluginCommonModule],
    adminApiExtensions: {
        schema: gql`
            extend type Product {
                hasVariant(variantId: ID!): Boolean!
            }
        `,
        resolvers: [ProductHasVariantResolver],
    },
})
class FieldResolverIdTestPlugin {}

/**
 * The test config uses an EntityIdStrategy that encodes IDs ("T_1"). The ID values in the
 * arguments of entity field resolvers must be decoded in the same way as the ID values in the
 * arguments of root fields.
 */
describe('ID arguments of field resolvers', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), { plugins: [FieldResolverIdTestPlugin] }),
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        await awaitRunningJobs(adminClient);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('Product.variantList', async () => {
        const all = await adminClient.query(productVariantListDocument, { productId: 'T_1' });
        const target = all.product!.variantList.items[1];
        expect(target).toBeDefined();

        const filtered = await adminClient.query(productVariantListDocument, {
            productId: 'T_1',
            filter: { id: { eq: target.id } },
        });
        expect(filtered.product!.variantList.items).toEqual([target]);

        const filteredIn = await adminClient.query(productVariantListDocument, {
            productId: 'T_1',
            filter: { id: { in: [target.id] } },
        });
        expect(filteredIn.product!.variantList.items).toEqual([target]);
    });

    // graphql-js passes the same variable value to the field resolver of each parent. The value
    // must be decoded once per parent, not once for all parents.
    it('Product.variantList with a filter variable for many products', async () => {
        const all = await adminClient.query(productsVariantListDocument, {});
        const [first, second] = all.products.items;
        const targetIds = [first.variantList.items[0].id, second.variantList.items[0].id];

        const filtered = await adminClient.query(productsVariantListDocument, {
            filter: { id: { in: targetIds } },
        });
        expect(filtered.products.items).toEqual([
            { id: first.id, variantList: { items: [{ id: targetIds[0] }] } },
            { id: second.id, variantList: { items: [{ id: targetIds[1] }] } },
        ]);
    });

    // The decode of the root field must not change the variable value that the field resolver reads.
    // The test ID strategy throws for an ID that is already decoded.
    it('a filter variable used by a root field and by a field resolver', async () => {
        const all = await adminClient.query(productVariantListDocument, { productId: 'T_1' });
        const targetId = all.product!.variantList.items[1].id;

        const filtered = await adminClient.query(sharedFilterDocument, {
            filter: { id: { eq: targetId } },
        });
        expect(filtered.productVariants.items).toEqual([{ id: targetId }]);
        expect(filtered.product!.variantList.items).toEqual([{ id: targetId }]);
    });

    it('a plugin field resolver decodes its ID argument with IdArgumentDecoder', async () => {
        const { product } = await adminClient.query(gql`
            query {
                product(id: "T_1") {
                    variantInProduct: hasVariant(variantId: "T_2")
                    variantNotInProduct: hasVariant(variantId: "T_5")
                }
            }
        `);
        expect(product).toEqual({ variantInProduct: true, variantNotInProduct: false });
    });

    it('Collection.productVariants', async () => {
        const all = await adminClient.query(collectionVariantsDocument, { collectionId: 'T_2' });
        const target = all.collection!.productVariants.items[1];
        expect(target).toBeDefined();

        const filtered = await adminClient.query(collectionVariantsDocument, {
            collectionId: 'T_2',
            filter: { id: { eq: target.id } },
        });
        expect(filtered.collection!.productVariants.items).toEqual([target]);
    });

    it('Facet.valueList', async () => {
        const all = await adminClient.query(facetValueListDocument, { facetId: 'T_1' });
        const target = all.facet!.valueList.items[1];
        expect(target).toBeDefined();

        const filtered = await adminClient.query(facetValueListDocument, {
            facetId: 'T_1',
            filter: { id: { eq: target.id } },
        });
        expect(filtered.facet!.valueList.items).toEqual([target]);
    });

    it('CustomerGroup.customers', async () => {
        const { createCustomerGroup } = await adminClient.query(createCustomerGroupDocument, {
            customerIds: ['T_1'],
        });

        const filtered = await adminClient.query(customerGroupCustomersDocument, {
            groupId: createCustomerGroup.id,
            filter: { id: { eq: 'T_1' } },
        });
        expect(filtered.customerGroup!.customers.items).toEqual([{ id: 'T_1' }]);
    });

    it('Customer.orders and Order.history', async () => {
        const { customer } = await adminClient.query(customerEmailDocument, { customerId: 'T_1' });
        await shopClient.asUserWithCredentials(customer!.emailAddress, 'test');
        const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
            productVariantId: 'T_1',
            quantity: 1,
        });
        const orderId = (addItemToOrder as { id: string }).id;

        const orders = await adminClient.query(customerOrdersDocument, {
            customerId: 'T_1',
            filter: { id: { eq: orderId } },
        });
        expect(orders.customer!.orders.items).toEqual([{ id: orderId }]);

        const all = await adminClient.query(orderHistoryDocument, { orderId });
        const target = all.order!.history.items[0];
        expect(target).toBeDefined();

        const filtered = await adminClient.query(orderHistoryDocument, {
            orderId,
            filter: { id: { eq: target.id } },
        });
        expect(filtered.order!.history.items).toEqual([target]);
    });

    it('Customer.history', async () => {
        const all = await adminClient.query(customerHistoryDocument, { customerId: 'T_1' });
        const target = all.customer!.history.items[0];
        expect(target).toBeDefined();

        const filtered = await adminClient.query(customerHistoryDocument, {
            customerId: 'T_1',
            filter: { id: { eq: target.id } },
        });
        expect(filtered.customer!.history.items).toEqual([target]);
    });
});

const productVariantListDocument = graphql(`
    query FieldResolverIdProductVariantList($productId: ID!, $filter: ProductVariantFilterParameter) {
        product(id: $productId) {
            variantList(options: { filter: $filter, sort: { id: ASC } }) {
                items {
                    id
                }
            }
        }
    }
`);

const productsVariantListDocument = graphql(`
    query FieldResolverIdProductsVariantList($filter: ProductVariantFilterParameter) {
        products(options: { take: 2, sort: { id: ASC } }) {
            items {
                id
                variantList(options: { filter: $filter, sort: { id: ASC } }) {
                    items {
                        id
                    }
                }
            }
        }
    }
`);

const sharedFilterDocument = graphql(`
    query FieldResolverIdSharedFilter($filter: ProductVariantFilterParameter) {
        productVariants(options: { filter: $filter }) {
            items {
                id
            }
        }
        product(id: "T_1") {
            variantList(options: { filter: $filter }) {
                items {
                    id
                }
            }
        }
    }
`);

const collectionVariantsDocument = graphql(`
    query FieldResolverIdCollectionVariants($collectionId: ID!, $filter: ProductVariantFilterParameter) {
        collection(id: $collectionId) {
            productVariants(options: { filter: $filter, sort: { id: ASC } }) {
                items {
                    id
                }
            }
        }
    }
`);

const facetValueListDocument = graphql(`
    query FieldResolverIdFacetValueList($facetId: ID!, $filter: FacetValueFilterParameter) {
        facet(id: $facetId) {
            valueList(options: { filter: $filter, sort: { id: ASC } }) {
                items {
                    id
                }
            }
        }
    }
`);

const createCustomerGroupDocument = graphql(`
    mutation FieldResolverIdCreateCustomerGroup($customerIds: [ID!]) {
        createCustomerGroup(input: { name: "field resolver ids", customerIds: $customerIds }) {
            id
        }
    }
`);

const customerGroupCustomersDocument = graphql(`
    query FieldResolverIdCustomerGroupCustomers($groupId: ID!, $filter: CustomerFilterParameter) {
        customerGroup(id: $groupId) {
            customers(options: { filter: $filter }) {
                items {
                    id
                }
            }
        }
    }
`);

const customerEmailDocument = graphql(`
    query FieldResolverIdCustomerEmail($customerId: ID!) {
        customer(id: $customerId) {
            emailAddress
        }
    }
`);

const customerOrdersDocument = graphql(`
    query FieldResolverIdCustomerOrders($customerId: ID!, $filter: OrderFilterParameter) {
        customer(id: $customerId) {
            orders(options: { filter: $filter }) {
                items {
                    id
                }
            }
        }
    }
`);

const orderHistoryDocument = graphql(`
    query FieldResolverIdOrderHistory($orderId: ID!, $filter: HistoryEntryFilterParameter) {
        order(id: $orderId) {
            history(options: { filter: $filter }) {
                items {
                    id
                }
            }
        }
    }
`);

const customerHistoryDocument = graphql(`
    query FieldResolverIdCustomerHistory($customerId: ID!, $filter: HistoryEntryFilterParameter) {
        customer(id: $customerId) {
            history(options: { filter: $filter }) {
                items {
                    id
                }
            }
        }
    }
`);
