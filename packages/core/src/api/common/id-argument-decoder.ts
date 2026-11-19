import { Injectable } from '@nestjs/common';
import { IdOperators } from '@vendure/common/lib/generated-types';
import { GraphQLResolveInfo, GraphQLSchema } from 'graphql';

import { getApiType } from './get-api-type';
import { GraphqlValueTransformer } from './graphql-value-transformer';
import { IdCodecService } from './id-codec.service';

/**
 * The Admin API fields whose `ID` arguments are job ids rather than entity ids, keyed by parent
 * type name. Their arguments are not decoded unless {@link IdCodecService.transformJobIds} is true.
 */
const JOB_ID_FIELDS: Record<string, string[]> = {
    Query: ['job', 'jobsById'],
    Mutation: ['cancelJob'],
};

/**
 * Decodes the ID values in the arguments of a GraphQL field as per the configured EntityIdStrategy.
 * It finds the ID values by the argument types of the field: values of type `ID` and the
 * operators of `IDOperators` inputs.
 *
 * The {@link IdInterceptor} uses it for root fields. Field resolvers that have arguments with ID
 * values must call {@link IdArgumentDecoder.decode} themselves, because the interceptor does not run
 * for field resolvers.
 */
@Injectable()
export class IdArgumentDecoder {
    private graphQlValueTransformers = new WeakMap<GraphQLSchema, GraphqlValueTransformer>();

    constructor(private idCodecService: IdCodecService) {}

    /**
     * Returns a copy of `args` with the ID values decoded. Use it in field resolvers. graphql-js gives
     * the same variable values to the field resolver of each parent object, so a decode in place
     * would decode those values more than one time.
     */
    decode<T extends Record<string, any>>(info: GraphQLResolveInfo, args: T): T {
        const copy = copyInputValue(args);
        this.decodeInPlace(info, copy);
        return copy;
    }

    /**
     * Decodes the ID values in `args` in place.
     */
    decodeInPlace(info: GraphQLResolveInfo, args: Record<string, any> = {}): void {
        if (this.isUntransformedJobIdField(info)) {
            return;
        }
        // Read the argument types from the definition of the field being resolved. `info.operation`
        // does not include named fragment definitions, and two fields in one operation can each have
        // an argument of the same name with a different input type.
        const field = info.parentType.getFields()[info.fieldName];
        const transformer = this.getTransformerForSchema(info.schema);
        const typeTree = transformer.getArgumentTypeTree(field);
        transformer.transformValues(typeTree, args, (value, type) => {
            if (type?.name === 'ID') {
                return this.idCodecService.decode(value);
            }
            if (type?.name === 'IDOperators') {
                const keys: Array<keyof IdOperators> = ['eq', 'notEq', 'in', 'notIn'];
                return this.idCodecService.decode(value, keys);
            }
            return value;
        });
    }

    private isUntransformedJobIdField(info: GraphQLResolveInfo): boolean {
        return (
            !this.idCodecService.transformJobIds &&
            !!JOB_ID_FIELDS[info.parentType.name]?.includes(info.fieldName) &&
            getApiType(info) === 'admin'
        );
    }

    private getTransformerForSchema(schema: GraphQLSchema): GraphqlValueTransformer {
        const existing = this.graphQlValueTransformers.get(schema);
        if (existing) {
            return existing;
        }
        const transformer = new GraphqlValueTransformer(schema);
        this.graphQlValueTransformers.set(schema, transformer);
        return transformer;
    }
}

/**
 * Copies the plain objects and arrays of a GraphQL input value. Other values (for example the `Date`
 * of a `DateTime` scalar) are kept as they are.
 */
function copyInputValue<T>(value: T): T {
    if (Array.isArray(value)) {
        return value.map(copyInputValue) as T;
    }
    if (value !== null && typeof value === 'object') {
        const prototype = Object.getPrototypeOf(value);
        if (prototype === Object.prototype || prototype === null) {
            const copy: Record<string, unknown> = {};
            for (const [key, item] of Object.entries(value)) {
                copy[key] = copyInputValue(item);
            }
            return copy as T;
        }
    }
    return value;
}
