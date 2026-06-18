import { Query, Resolver } from '@nestjs/graphql';
import { VendurePlugin } from '@vendure/core';
import { GraphQLScalarType } from 'graphql';
import gql from 'graphql-tag';

@Resolver()
export class TestAdminPluginResolver {
    @Query()
    foo() {
        return ['bar'];
    }

    @Query()
    barList() {
        return {
            items: [{ id: 1, name: 'Test', pizzaType: 'Cheese' }],
            totalItems: 1,
        };
    }
}

@Resolver()
export class TestShopPluginResolver {
    @Query()
    baz() {
        return ['quux'];
    }
}

const PizzaScalar = new GraphQLScalarType({
    name: 'Pizza',
    description: 'Everything is pizza',
    serialize(value) {
        return ((value as any).toString() as string) + ' pizza!';
    },
    parseValue(value) {
        return value;
    },
});

@VendurePlugin({
    shopApiExtensions: {
        resolvers: [TestShopPluginResolver],
        schema: gql`
            extend type Query {
                baz: [String]!
            }
        `,
    },
    adminApiExtensions: {
        resolvers: [TestAdminPluginResolver],
        schema: gql`
            scalar Pizza
            extend type Query {
                foo: [String]!
                barList(options: BarListOptions): BarList!
            }

            input BarListOptions
            type Bar implements Node {
                id: ID!
                name: String!
                pizzaType: Pizza!
            }
            type BarList implements PaginatedList {
                items: [Bar!]!
                totalItems: Int!
            }
        `,
        scalars: { Pizza: PizzaScalar },
    },
})
export class TestAPIExtensionPlugin {}
