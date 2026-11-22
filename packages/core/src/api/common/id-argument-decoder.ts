import { Injectable } from '@nestjs/common';
import { IdOperators } from '@vendure/common/lib/generated-types';
import {
    getNullableType,
    GraphQLInputType,
    GraphQLResolveInfo,
    isInputObjectType,
    isListType,
} from 'graphql';

import { getApiType } from './get-api-type';
import { IdCodecService } from './id-codec.service';

/**
 * The Admin API fields whose `ID` arguments are job ids rather than entity ids, keyed by parent
 * type name. Their arguments are not decoded unless {@link IdCodecService.transformJobIds} is true.
 */
const JOB_ID_FIELDS: Record<string, string[]> = {
    Query: ['job', 'jobsById'],
    Mutation: ['cancelJob'],
};

const ID_OPERATOR_KEYS: Array<keyof IdOperators> = ['eq', 'notEq', 'in', 'notIn'];

/**
 * @description
 * Decodes the ID values in the arguments of a GraphQL field as per the configured
 * {@link EntityIdStrategy}. It finds the ID values by the argument types of the field: values of
 * type `ID` and the operators of `IDOperators` inputs.
 *
 * The `IdInterceptor` decodes the arguments of queries and mutations, but it does not run for field
 * resolvers. A field resolver, for example in a plugin, that has arguments with ID values must
 * inject the IdArgumentDecoder and call `decode(info, args)` itself.
 *
 * @example
 * ```ts
 * import { Args, Info, Parent, ResolveField, Resolver } from '\@nestjs/graphql';
 * import { Ctx, IdArgumentDecoder, Product, RequestContext } from '\@vendure/core';
 * import { GraphQLResolveInfo } from 'graphql';
 *
 * \@Resolver('Product')
 * export class ProductReviewsResolver {
 *     constructor(
 *         private idArgumentDecoder: IdArgumentDecoder,
 *         private reviewService: ReviewService,
 *     ) {}
 *
 *     \@ResolveField()
 *     reviews(
 *         \@Ctx() ctx: RequestContext,
 *         \@Parent() product: Product,
 *         \@Args() args: { options: ReviewListOptions },
 *         \@Info() info: GraphQLResolveInfo,
 *     ) {
 *         const { options } = this.idArgumentDecoder.decode(info, args);
 *         return this.reviewService.findByProductId(ctx, product.id, options);
 *     }
 * }
 * ```
 *
 * @docsCategory request
 * @since 4.0.0
 */
@Injectable()
export class IdArgumentDecoder {
    constructor(private idCodecService: IdCodecService) {}

    /**
     * @description
     * Returns a copy of `args` with the ID values decoded. Use it in field resolvers.
     */
    decode<T extends Record<string, any>>(info: GraphQLResolveInfo, args: T): T {
        const copy = { ...args };
        this.decodeInPlace(info, copy);
        return copy;
    }

    /**
     * @description
     * Decodes the ID values in `args` and assigns the decoded arguments to the keys of `args`. It does
     * not change the objects in the argument values. graphql-js gives the same variable values to
     * each field that uses the variable, so a change to them would decode them again in the next
     * field. The `IdInterceptor` uses this method for the arguments of queries and mutations.
     */
    decodeInPlace(info: GraphQLResolveInfo, args: Record<string, any> = {}): void {
        if (this.isUntransformedJobIdField(info)) {
            return;
        }
        // Read the argument types from the definition of the field being resolved. `info.operation`
        // does not include named fragment definitions, and two fields in one operation can each have
        // an argument of the same name with a different input type.
        const field = info.parentType.getFields()[info.fieldName];
        for (const arg of field.args) {
            if (arg.name in args) {
                args[arg.name] = this.decodeValue(args[arg.name], arg.type);
            }
        }
    }

    /**
     * Returns the decoded value. It walks the value together with its input type, so there is no
     * depth limit for input types that reference themselves, such as the `_and` of a filter.
     */
    private decodeValue(value: unknown, type: GraphQLInputType): unknown {
        if (value == null) {
            return value;
        }
        const nullableType = getNullableType(type);
        if (isListType(nullableType)) {
            return Array.isArray(value)
                ? value.map(item => this.decodeValue(item, nullableType.ofType))
                : this.decodeValue(value, nullableType.ofType);
        }
        if (nullableType.name === 'ID') {
            return this.idCodecService.decode(value as string);
        }
        if (nullableType.name === 'IDOperators') {
            return this.idCodecService.decode(value, ID_OPERATOR_KEYS);
        }
        if (isInputObjectType(nullableType) && typeof value === 'object') {
            const fields = nullableType.getFields();
            const result: Record<string, unknown> = {};
            for (const [key, item] of Object.entries(value)) {
                result[key] = fields[key] ? this.decodeValue(item, fields[key].type) : item;
            }
            return result;
        }
        return value;
    }

    private isUntransformedJobIdField(info: GraphQLResolveInfo): boolean {
        return (
            !this.idCodecService.transformJobIds &&
            !!JOB_ID_FIELDS[info.parentType.name]?.includes(info.fieldName) &&
            getApiType(info) === 'admin'
        );
    }
}
