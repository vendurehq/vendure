import { CustomScalar, Resolver, Scalar } from '@nestjs/graphql';
import { VendurePlugin } from '@vendure/core';
import { Kind, ValueNode } from 'graphql';
import gql from 'graphql-tag';

@Resolver('MyDate')
export class DateScalar implements CustomScalar<number, Date> {
    description = 'Date custom scalar type';

    parseValue(value: number): Date {
        return new Date(value); // value from the client
    }

    serialize(value: Date): number {
        return value.getTime(); // value sent to the client
    }

    parseLiteral(ast: ValueNode): Date | null {
        if (ast.kind === Kind.INT) {
            return new Date(ast.value);
        }
        return null;
    }
}

@VendurePlugin({
    providers: [DateScalar],
    shopApiExtensions: {
        resolvers: [DateScalar],
    },
})
export class CustomScalarPlugin {}
