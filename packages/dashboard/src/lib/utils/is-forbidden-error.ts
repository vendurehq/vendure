/**
 * Whether a GraphQL request failed because the request has no session or lacks permission.
 * `api.query`/`api.mutate` throw a `GraphQLRequestError`, which carries the Vendure error
 * code in `extensions.code`.
 */
export function isForbiddenError(error: unknown): boolean {
    const code = (error as { extensions?: { code?: unknown } } | null)?.extensions?.code;
    return code === 'FORBIDDEN' || code === 'UNAUTHORIZED';
}
