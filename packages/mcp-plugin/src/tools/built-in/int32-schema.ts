import { z } from 'zod';

export const GRAPHQL_INT_MIN = -2147483648;
export const GRAPHQL_INT_MAX = 2147483647;

/** Matches GraphQL's signed 32-bit Int scalar. */
export const int32Schema = z.number().int().min(GRAPHQL_INT_MIN).max(GRAPHQL_INT_MAX);
