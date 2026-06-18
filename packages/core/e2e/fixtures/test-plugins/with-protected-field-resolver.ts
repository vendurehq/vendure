import { ResolveField, Resolver } from '@nestjs/graphql';
import { Allow, PermissionDefinition, VendurePlugin } from '@vendure/core';
import gql from 'graphql-tag';

export const transactions = new PermissionDefinition({
    name: 'Transactions',
    description: 'Allows reading of transaction data',
});

@Resolver('Product')
export class ProductEntityResolver {
    @Allow(transactions.Permission)
    @ResolveField()
    transactions() {
        return [
            { id: 1, amount: 100, description: 'credit' },
            { id: 2, amount: -50, description: 'debit' },
        ];
    }
}

@VendurePlugin({
    adminApiExtensions: {
        resolvers: [ProductEntityResolver],
        schema: gql`
            extend type Query {
                transactions: [Transaction!]!
            }

            extend type Product {
                transactions: [Transaction!]!
            }

            type Transaction implements Node {
                id: ID!
                amount: Int!
                description: String!
            }
        `,
    },
    configuration: config => {
        config.authOptions.customPermissions.push(transactions);
        return config;
    },
})
export class ProtectedFieldsPlugin {}
