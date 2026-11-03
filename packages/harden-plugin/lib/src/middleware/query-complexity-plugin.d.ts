import { ApolloServerPlugin, GraphQLRequestListener, GraphQLRequestContext } from '@apollo/server';
import { ComplexityEstimatorArgs } from 'graphql-query-complexity';
import { HardenPluginOptions } from '../types';
/**
 * @description
 * Implements query complexity analysis on Shop API requests.
 */
export declare class QueryComplexityPlugin implements ApolloServerPlugin {
    private options;
    constructor(options: HardenPluginOptions);
    requestDidStart(context: GraphQLRequestContext<any>): Promise<GraphQLRequestListener<any>>;
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
export declare function defaultVendureComplexityEstimator(customComplexityFactors: {
    [path: string]: number;
}, logFieldScores: boolean): (options: ComplexityEstimatorArgs) => number | void;
