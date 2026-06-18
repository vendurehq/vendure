import { Query, Resolver } from '@nestjs/graphql';
import { VendurePlugin } from '@vendure/core';
import gql from 'graphql-tag';

@Resolver()
export class TestLazyResolver {
    @Query()
    lazy() {
        return 'sleeping';
    }
}

@VendurePlugin({
    shopApiExtensions: {
        resolvers: () => [TestLazyResolver],
        schema: () => gql`
            extend type Query {
                lazy: String!
            }
        `,
    },
})
export class TestLazyExtensionPlugin {}
