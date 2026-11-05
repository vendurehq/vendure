import { z } from 'zod';

/**
 * @description
 * The smallest value a GraphQL `Int` can hold: -2147483648.
 *
 * @docsCategory mcp-sdk
 * @since 3.8.0
 */
export const GRAPHQL_INT_MIN = -2147483648;

/**
 * @description
 * The largest value a GraphQL `Int` can hold: 2147483647.
 *
 * @docsCategory mcp-sdk
 * @since 3.8.0
 */
export const GRAPHQL_INT_MAX = 2147483647;

/**
 * @description
 * A Zod schema for a whole number that fits a GraphQL `Int`. Use it for quantities and other
 * integers Vendure stores in an `int` column. Chain `.min()` or `.max()` to narrow it.
 *
 * @docsCategory mcp-sdk
 * @since 3.8.0
 */
export const int32Schema = z.number().int().min(GRAPHQL_INT_MIN).max(GRAPHQL_INT_MAX);
