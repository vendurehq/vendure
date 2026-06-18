import { GraphQLResolveInfo } from 'graphql';

/**
 * Returns true is this guard is being called on a FieldResolver, i.e. not a top-level
 * Query or Mutation resolver.
 */
export function isFieldResolver(info?: GraphQLResolveInfo): boolean {
    if (!info) {
        return false;
    }
    const parentType = info?.parentType?.name;
    return parentType !== 'Query' && parentType !== 'Mutation' && parentType !== 'Subscription';
}
