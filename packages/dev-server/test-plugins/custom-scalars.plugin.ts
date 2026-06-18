import { PluginCommonModule, VendurePlugin } from '@vendure/core';
import { GraphQLScalarType, Kind } from 'graphql';
import gql from 'graphql-tag';

const FooScalar = new GraphQLScalarType({
    name: 'FooScalar',
    description: 'A test scalar',
    serialize(value) {
        return value.toString() + '-foo';
    },
    parseValue(value) {
        return value.toString().split('-foo')[0];
    },
});

@VendurePlugin({
    imports: [PluginCommonModule],
    shopApiExtensions: {
        schema: gql`
            scalar FooScalar
        `,
        scalars: { FooScalar },
    },
})
export class CustomScalarsPlugin {}
