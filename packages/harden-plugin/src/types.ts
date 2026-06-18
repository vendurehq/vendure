import { GraphQLRequestContext } from '@apollo/server';
import { ComplexityEstimator } from 'graphql-query-complexity';

/**
 * @description
 * Options that can be passed to the `.init()` static method of the HardenPlugin.
 *
 * @docsCategory core plugins/HardenPlugin
 */
export interface HardenPluginOptions {
    /**
     * @description
     * Defines the maximum permitted complexity score of a query. The complexity score is based
     * on the number of fields being selected as well as other factors like whether there are nested
     * lists.
     *
     * A query which exceeds the maximum score will result in an error.
     *
     * @default 1000
     */
    maxQueryComplexity?: number;
    /**
     * @description
     * An array of custom estimator functions for calculating the complexity of a query. By default,
     * the plugin will use the {@link defaultVendureComplexityEstimator} which is specifically
     * tuned to accurately estimate Vendure queries.
     */
    queryComplexityEstimators?: ComplexityEstimator[];
    /**
     * @description
     * When set to `true`, the complexity score of each query will be logged at the Verbose
     * log level, and a breakdown of the calculation for each field will be logged at the Debug level.
     *
     * This is very useful for tuning your complexity scores.
     *
     * @default false
     */
    logComplexityScore?: boolean;

    /**
     * @description
     * This object allows you to tune the complexity weight of specific fields. For example,
     * if you have a custom `stockLocations` field defined on the `ProductVariant` type, and
     * you know that it is a particularly expensive operation to execute, you can increase
     * its complexity like this:
     *
     * @example
     * ```ts
     * HardenPlugin.init({
     *   maxQueryComplexity: 650,
     *   customComplexityFactors: {
     *     'ProductVariant.stockLocations': 10
     *   }
     * }),
     * ```
     */
    customComplexityFactors?: {
        [path: string]: number;
    };

    /**
     * @description
     * Graphql-js will make suggestions about the names of fields if an invalid field name is provided.
     * This would allow an attacker to find out the available fields by brute force even if introspection
     * is disabled.
     *
     * Setting this option to `true` will prevent these suggestion error messages from being returned,
     * instead replacing the message with a generic "Invalid request" message.
     *
     * @default true
     */
    hideFieldSuggestions?: boolean;
    /**
     * @description
     * When set to `'prod'`, the plugin will disable dev-mode features of the GraphQL APIs:
     *
     * - introspection
     * - GraphQL playground
     *
     * @default 'prod'
     */
    apiMode?: 'dev' | 'prod';
    /**
     * @description
     * Allows you to skip the complexity check for certain requests.
     *
     * @example
     * ```ts
     * HardenPlugin.init({
     *   skip: (context) => context.request.http.headers['x-storefront-ssr-auth'] === 'some-secret-token'
     * }),
     * ```
     */
    skip?: (context: GraphQLRequestContext<any>) => Promise<boolean> | boolean;
}
