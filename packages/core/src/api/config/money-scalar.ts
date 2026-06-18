import { GraphQLError, GraphQLScalarType, Kind, print } from 'graphql';
import { inspect } from 'graphql/jsutils/inspect';

export function isObjectLike(value: unknown): value is { [key: string]: unknown } {
    // eslint-disable-next-line eqeqeq
    return typeof value == 'object' && value !== null;
}

// Support serializing objects with custom valueOf() or toJSON() functions -
// a common way to represent a complex value which can be represented as
// a string (ex: MongoDB id objects).
function serializeObject(outputValue: unknown): unknown {
    if (isObjectLike(outputValue)) {
        if (typeof outputValue.valueOf === 'function') {
            const valueOfResult = outputValue.valueOf();
            if (!isObjectLike(valueOfResult)) {
                return valueOfResult;
            }
        }
        if (typeof outputValue.toJSON === 'function') {
            return outputValue.toJSON();
        }
    }
    return outputValue;
}

/**
 * @description
 * The Money scalar is used to represent monetary values in the GraphQL API. It is based on the native `Float` scalar.
 */
export const GraphQLMoney = new GraphQLScalarType<number>({
    name: 'Money',
    description:
        'The `Money` scalar type represents monetary values and supports signed double-precision ' +
        'fractional values as specified by [IEEE 754](https://en.wikipedia.org/wiki/IEEE_floating_point).',
    serialize(outputValue) {
        const coercedValue = serializeObject(outputValue);

        if (typeof coercedValue === 'boolean') {
            return coercedValue ? 1 : 0;
        }

        let num = coercedValue;
        if (typeof coercedValue === 'string' && coercedValue !== '') {
            num = Number(coercedValue);
        }

        if (typeof num !== 'number' || !Number.isFinite(num)) {
            throw new GraphQLError(`Money cannot represent non numeric value: ${inspect(coercedValue)}`);
        }
        return num;
    },

    parseValue(inputValue) {
        if (typeof inputValue !== 'number' || !Number.isFinite(inputValue)) {
            throw new GraphQLError(`Money cannot represent non numeric value: ${inspect(inputValue)}`);
        }
        return inputValue;
    },

    parseLiteral(valueNode) {
        if (valueNode.kind !== Kind.FLOAT && valueNode.kind !== Kind.INT) {
            throw new GraphQLError(`Money cannot represent non numeric value: ${print(valueNode)}`, {
                nodes: valueNode,
            });
        }
        return parseFloat(valueNode.value);
    },
    extensions: {
        codegenScalarType: 'number',
        jsonSchema: {
            title: 'Money',
            type: 'number',
            minimum: Number.MIN_SAFE_INTEGER,
            maximum: Number.MAX_SAFE_INTEGER,
        },
    },
});
