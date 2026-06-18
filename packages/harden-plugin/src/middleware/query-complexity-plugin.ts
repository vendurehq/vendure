import { ApolloServerPlugin, GraphQLRequestListener, GraphQLRequestContext } from '@apollo/server';
import { InternalServerError, Logger } from '@vendure/core';
import {
    getNamedType,
    getNullableType,
    GraphQLSchema,
    isListType,
    isObjectType,
    separateOperations,
} from 'graphql';
import { ComplexityEstimatorArgs, getComplexity, simpleEstimator } from 'graphql-query-complexity';

import { loggerCtx } from '../constants';
import { HardenPluginOptions } from '../types';

/**
 * @description
 * Implements query complexity analysis on Shop API requests.
 */
export class QueryComplexityPlugin implements ApolloServerPlugin {
    constructor(private options: HardenPluginOptions) {}

    async requestDidStart(context: GraphQLRequestContext<any>): Promise<GraphQLRequestListener<any>> {
        const maxQueryComplexity = this.options.maxQueryComplexity ?? 1000;
        return {
            didResolveOperation: async ({ request, document }) => {
                if (isAdminApi(context.schema)) {
                    // We don't want to apply the cost analysis on the
                    // Admin API, since any expensive operations would require
                    // an authenticated session.
                    return;
                }
                if (await this.options.skip?.(context)) {
                    // Given skip function tells use we should not check this request for complexity
                    return;
                }
                const query = request.operationName
                    ? separateOperations(document)[request.operationName]
                    : document;

                if (this.options.logComplexityScore === true) {
                    Logger.debug(
                        `Calculating complexity of "${request.operationName ?? 'anonymous'}"`,
                        loggerCtx,
                    );
                }
                const complexity = getComplexity({
                    schema: context.schema,
                    query,
                    variables: request.variables,
                    estimators: this.options.queryComplexityEstimators ?? [
                        defaultVendureComplexityEstimator(
                            this.options.customComplexityFactors ?? {},
                            this.options.logComplexityScore ?? false,
                        ),
                        simpleEstimator({ defaultComplexity: 1 }),
                    ],
                });

                if (this.options.logComplexityScore === true) {
                    Logger.verbose(
                        `Query complexity "${request.operationName ?? 'anonymous'}": ${complexity}`,
                        loggerCtx,
                    );
                }
                if (complexity >= maxQueryComplexity) {
                    Logger.error(
                        `Query complexity of "${
                            request.operationName ?? 'anonymous'
                        }" is ${complexity}, which exceeds the maximum of ${maxQueryComplexity}`,
                        loggerCtx,
                    );
                    throw new InternalServerError('Query is too complex');
                }
            },
        };
    }
}

function isAdminApi(schema: GraphQLSchema): boolean {
    const queryType = schema.getQueryType();
    if (queryType) {
        return !!queryType.getFields().administrators;
    }
    return false;
}

/**
 * @description
 * A complexity estimator which takes into account List and PaginatedList types and can
 * be further configured by providing a customComplexityFactors object.
 *
 * When selecting PaginatedList types, the "take" argument is used to estimate a complexity
 * factor. If the "take" argument is omitted, a default factor of 1000 is applied.
 *
 * @docsCategory core plugins/HardenPlugin
 */
export function defaultVendureComplexityEstimator(
    customComplexityFactors: { [path: string]: number },
    logFieldScores: boolean,
) {
    return (options: ComplexityEstimatorArgs): number | void => {
        const { type, args, childComplexity, field } = options;
        const namedType = getNamedType(field.type);
        const path = `${type.name}.${field.name}`;
        let result = childComplexity + 1;
        const customFactor = customComplexityFactors[path];
        if (customFactor != null) {
            result = Math.max(childComplexity, 1) * customFactor;
        } else {
            if (isObjectType(namedType)) {
                const isPaginatedList = !!namedType.getInterfaces().find(i => i.name === 'PaginatedList');
                if (isPaginatedList) {
                    const take = args.options?.take ?? 1000;
                    result = childComplexity + Math.round(Math.log(childComplexity) * take);
                }
            }
            if (isListType(getNullableType(field.type))) {
                result = childComplexity * 5;
            }
        }
        if (logFieldScores) {
            Logger.debug(
                `${path}: ${field.type.toString()}\tchildComplexity: ${childComplexity}, score: ${result}`,
                loggerCtx,
            );
        }
        return result;
    };
}
